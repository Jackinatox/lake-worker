import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/core/prisma.service';
import {
  GameServerStatus,
  LogLevel,
  LogType,
  WorkerJobType,
} from 'src/generated/prisma/client';
import { JobRunService, JobContext } from '../services/job-run.service';
import { DEFAULT_BATCH_SIZE } from 'src/lib/GlobalConsstants';
import { expiredSuspensionWhere } from 'src/lib/gameserver/suspension';

/** Prefix the lake's admin UI queries ApplicationLog by to build the suspension history. */
const SUSPENSION_EVENT_PREFIX = 'SUSPENSION_';

/** The Pterodactyl fields the job needs, plus the lifecycle state it must not overwrite. */
const serverSelect = {
  id: true,
  userId: true,
  name: true,
  status: true,
  expires: true,
  ptAdminId: true,
  ptServerId: true,
} as const;

type SuspendedServer = {
  id: string;
  userId: string;
  name: string;
  status: GameServerStatus;
  expires: Date;
  ptAdminId: number | null;
  ptServerId: string | null;
};

type DueSuspension = {
  id: string;
  gameServerId: string;
  reason: string;
  expiresAt: Date;
  deleteAfterExpiry: boolean;
  gameServer: SuspendedServer;
};

/**
 * Closes out suspensions whose end date has passed.
 *
 * A suspension freezes a server in Pterodactyl without touching `GameServer.status`, so a
 * server can sit suspended while it is ACTIVE *or* while it is EXPIRED. When the end date
 * arrives this job either deletes the server (`deleteAfterExpiry`) or releases it — and
 * releasing means PT-unsuspending it **only** when the lifecycle says it should be
 * running, otherwise a quarantined-and-expired server would come back to life.
 *
 * Every suspension row is closed by setting `liftedAt`; `liftedByUserId` stays null, which
 * is what distinguishes "the worker ran it out" from "an admin released it early".
 */
@Injectable()
export class ProcessSuspensionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jobRunService: JobRunService,
  ) {}

  async run(): Promise<{ processed: number; total: number; failed: number }> {
    const ctx = await this.jobRunService.startJobRun(
      WorkerJobType.PROCESS_SUSPENSIONS,
    );

    let processed = 0;
    let failed = 0;
    const now = new Date();

    const total = await this.prisma.gameServerSuspension.count({
      where: expiredSuspensionWhere(now),
    });

    await this.jobRunService.logInfo(
      ctx,
      `Job started, processing ${total} expired suspensions`,
      { totalSuspensions: total, batchSize: DEFAULT_BATCH_SIZE },
    );

    try {
      // One batch per run: a suspension that fails keeps its `liftedAt = null` and would
      // otherwise be re-fetched forever by a drain loop. The next run picks up the rest.
      const due = await this.prisma.gameServerSuspension.findMany({
        where: expiredSuspensionWhere(now),
        take: DEFAULT_BATCH_SIZE,
        orderBy: { expiresAt: 'asc' },
        select: {
          id: true,
          gameServerId: true,
          reason: true,
          expiresAt: true,
          deleteAfterExpiry: true,
          gameServer: { select: serverSelect },
        },
      });

      if (total > due.length) {
        await this.jobRunService.logWarn(
          ctx,
          'More expired suspensions than fit in one batch, the rest follow next run',
          { totalSuspensions: total, batchSize: due.length },
        );
      }

      for (const suspension of due) {
        try {
          await this.processSuspension(suspension, ctx);
          processed++;
          await this.jobRunService.updateProgress(
            ctx.jobRunId,
            processed,
            total,
            failed,
          );
        } catch (error) {
          failed++;
          await this.jobRunService.logError(
            ctx,
            'Failed to process individual suspension',
            {
              suspensionId: suspension.id,
              serverId: suspension.gameServerId,
              deleteAfterExpiry: suspension.deleteAfterExpiry,
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
            {
              gameServerId: suspension.gameServerId,
              userId: suspension.gameServer.userId,
            },
          );
        }
      }

      await this.jobRunService.completeJobRun(ctx.jobRunId, {
        processed,
        total,
        failed,
      });
      return { processed, total, failed };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await this.jobRunService.failJobRun(ctx.jobRunId, err, {
        processed,
        total,
        failed,
      });
      throw error;
    }
  }

  private async processSuspension(
    suspension: DueSuspension,
    ctx: JobContext,
  ): Promise<void> {
    const server = suspension.gameServer;
    const entity = { gameServerId: server.id, userId: server.userId };

    await this.jobRunService.logInfo(
      ctx,
      'Starting to handle expired suspension',
      {
        suspensionId: suspension.id,
        serverId: server.id,
        serverName: server.name,
        ptServerId: server.ptServerId,
        ptAdminId: server.ptAdminId,
        suspensionExpiredAt: suspension.expiresAt.toISOString(),
        deleteAfterExpiry: suspension.deleteAfterExpiry,
        currentStatus: server.status,
      },
      entity,
    );

    // An admin may have lifted the suspension between the query and now. Bail out rather
    // than deleting a server somebody just released.
    const stillOpen = await this.prisma.gameServerSuspension.findUnique({
      where: { id: suspension.id },
      select: { liftedAt: true },
    });

    if (!stillOpen || stillOpen.liftedAt !== null) {
      await this.jobRunService.logWarn(
        ctx,
        'Suspension was lifted or removed while the job was running, skipping',
        { suspensionId: suspension.id, serverId: server.id },
        entity,
      );
      return;
    }

    if (suspension.deleteAfterExpiry) {
      await this.deleteSuspendedServer(suspension, server, ctx);
    } else {
      await this.releaseSuspendedServer(suspension, server, ctx);
    }
  }

  /**
   * `deleteAfterExpiry = true`: the server is gone for good — delete it in Pterodactyl and
   * put it into the DELETED lifecycle state.
   */
  private async deleteSuspendedServer(
    suspension: DueSuspension,
    server: SuspendedServer,
    ctx: JobContext,
  ): Promise<void> {
    const entity = { gameServerId: server.id, userId: server.userId };
    let deletedInPterodactyl = false;

    if (server.status === GameServerStatus.DELETED) {
      await this.jobRunService.logWarn(
        ctx,
        'Server is already DELETED, only closing the suspension',
        { suspensionId: suspension.id, serverId: server.id },
        entity,
      );
    } else if (!server.ptAdminId) {
      // Never provisioned (or half-provisioned): there is nothing to delete in PT, and
      // leaving the row open would make this suspension fail on every single run.
      await this.jobRunService.logWarn(
        ctx,
        'Server has no Pterodactyl ID, marking it DELETED without a Pterodactyl call',
        {
          suspensionId: suspension.id,
          serverId: server.id,
          currentStatus: server.status,
        },
        entity,
      );
      await this.markServerDeleted(server, ctx);
    } else {
      await this.deleteServerInPterodactyl(server, ctx);
      await this.markServerDeleted(server, ctx);
      deletedInPterodactyl = true;
    }

    await this.closeSuspension(suspension, server, ctx, 'EXPIRED_DELETED', {
      deletedInPterodactyl,
      finalStatus: GameServerStatus.DELETED,
    });
  }

  /**
   * `deleteAfterExpiry = false`: the quarantine is over. Unsuspend in Pterodactyl **only**
   * when the lifecycle says the server should be running — an EXPIRED server is suspended
   * in PT for its own reason and must stay that way.
   */
  private async releaseSuspendedServer(
    suspension: DueSuspension,
    server: SuspendedServer,
    ctx: JobContext,
  ): Promise<void> {
    const entity = { gameServerId: server.id, userId: server.userId };

    const lifecycleAllowsRunning =
      (server.status === GameServerStatus.ACTIVE ||
        server.status === GameServerStatus.CREATED) &&
      server.expires.getTime() > Date.now();

    let unsuspended = false;

    if (!lifecycleAllowsRunning) {
      await this.jobRunService.logInfo(
        ctx,
        'Suspension over, but the server stays suspended in Pterodactyl because its lifecycle is not active',
        {
          suspensionId: suspension.id,
          serverId: server.id,
          currentStatus: server.status,
          expires: server.expires.toISOString(),
        },
        entity,
      );
    } else if (!server.ptAdminId) {
      await this.jobRunService.logWarn(
        ctx,
        'Server has no Pterodactyl ID, cannot unsuspend it, closing the suspension anyway',
        {
          suspensionId: suspension.id,
          serverId: server.id,
          currentStatus: server.status,
        },
        entity,
      );
    } else {
      await this.unsuspendServerInPterodactyl(server, ctx);
      unsuspended = true;
    }

    await this.closeSuspension(suspension, server, ctx, 'EXPIRED_LIFTED', {
      unsuspendedInPterodactyl: unsuspended,
      stillExpired: !lifecycleAllowsRunning,
      finalStatus: server.status,
    });
  }

  /**
   * Closes the row (`liftedAt`, no `liftedByUserId` — that null is how the lake tells a
   * worker release apart from an admin one) and appends the event to the suspension
   * history the admin UI reads out of ApplicationLog.
   */
  private async closeSuspension(
    suspension: DueSuspension,
    server: SuspendedServer,
    ctx: JobContext,
    event: 'EXPIRED_DELETED' | 'EXPIRED_LIFTED',
    details: Record<string, unknown>,
  ): Promise<void> {
    const liftedAt = new Date();

    // `liftedAt: null` in the filter keeps an admin who released the server mid-run from
    // being overwritten.
    const closed = await this.prisma.gameServerSuspension.updateMany({
      where: { id: suspension.id, liftedAt: null },
      data: { liftedAt },
    });

    if (closed.count === 0) {
      await this.jobRunService.logWarn(
        ctx,
        'Suspension was already closed by somebody else, not overwriting liftedAt',
        { suspensionId: suspension.id, serverId: server.id },
        { gameServerId: server.id, userId: server.userId },
      );
      return;
    }

    await this.jobRunService.logInfo(
      ctx,
      suspension.deleteAfterExpiry
        ? 'Suspension expired, server deleted and suspension closed'
        : 'Suspension expired and was lifted',
      {
        suspensionId: suspension.id,
        serverId: server.id,
        liftedAt: liftedAt.toISOString(),
        ...details,
      },
      { gameServerId: server.id, userId: server.userId },
    );

    await this.writeSuspensionHistory(suspension, server, ctx, event, {
      suspensionId: suspension.id,
      suspensionExpiredAt: suspension.expiresAt.toISOString(),
      deleteAfterExpiry: suspension.deleteAfterExpiry,
      reason: suspension.reason,
      ...details,
    });
  }

  /**
   * Mirrors the event into ApplicationLog so `getSuspensionHistory` in the lake shows what
   * the worker did next to what the admins did. A logging failure must not undo the work,
   * so this only warns.
   */
  private async writeSuspensionHistory(
    suspension: DueSuspension,
    server: SuspendedServer,
    ctx: JobContext,
    event: 'EXPIRED_DELETED' | 'EXPIRED_LIFTED',
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.applicationLog.create({
        data: {
          level: event === 'EXPIRED_DELETED' ? LogLevel.WARN : LogLevel.INFO,
          type: LogType.GAME_SERVER,
          instanceId: process.env.INSTANCE_ID ?? 'nest-lake-worker',
          message:
            event === 'EXPIRED_DELETED'
              ? 'Suspension expired, gameserver deleted by the worker'
              : 'Suspension expired, gameserver released by the worker',
          gameServerId: server.id,
          userId: server.userId,
          details: JSON.parse(
            JSON.stringify({
              event: `${SUSPENSION_EVENT_PREFIX}${event}`,
              ...details,
            }),
          ) as object,
        },
      });
    } catch (error) {
      await this.jobRunService.logWarn(
        ctx,
        'Failed to write the suspension history entry to ApplicationLog',
        {
          suspensionId: suspension.id,
          serverId: server.id,
          event: `${SUSPENSION_EVENT_PREFIX}${event}`,
          error: error instanceof Error ? error.message : String(error),
        },
        { gameServerId: server.id, userId: server.userId },
      );
    }
  }

  private async markServerDeleted(
    server: SuspendedServer,
    ctx: JobContext,
  ): Promise<void> {
    await this.prisma.gameServer.update({
      where: { id: server.id },
      data: { status: GameServerStatus.DELETED },
    });

    await this.jobRunService.logInfo(
      ctx,
      'Server marked as DELETED in database',
      { serverId: server.id, newStatus: GameServerStatus.DELETED },
      { gameServerId: server.id, userId: server.userId },
    );
  }

  private async deleteServerInPterodactyl(
    server: SuspendedServer,
    ctx: JobContext,
  ): Promise<void> {
    const entity = { gameServerId: server.id, userId: server.userId };

    await this.jobRunService.logInfo(
      ctx,
      'Deleting suspended server via Pterodactyl API',
      { serverId: server.id, ptAdminId: server.ptAdminId },
      entity,
    );

    const response = await this.callPterodactyl(
      `servers/${server.ptAdminId}`,
      'DELETE',
    );

    // PT is already rid of it — treat that as done instead of retrying forever.
    if (response.status === 404) {
      await this.jobRunService.logWarn(
        ctx,
        'Server no longer exists in Pterodactyl, treating the deletion as done',
        { serverId: server.id, ptAdminId: server.ptAdminId },
        entity,
      );
      return;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Pterodactyl API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    await this.jobRunService.logInfo(
      ctx,
      'Successfully deleted suspended server via Pterodactyl API',
      {
        serverId: server.id,
        ptAdminId: server.ptAdminId,
        responseStatus: response.status,
      },
      entity,
    );
  }

  /**
   * Hands the server back to its owner. Deliberately does not touch `GameServer.status` —
   * the lifecycle was never changed by the suspension in the first place.
   */
  private async unsuspendServerInPterodactyl(
    server: SuspendedServer,
    ctx: JobContext,
  ): Promise<void> {
    const entity = { gameServerId: server.id, userId: server.userId };

    await this.jobRunService.logInfo(
      ctx,
      'Unsuspending server via Pterodactyl API',
      { serverId: server.id, ptAdminId: server.ptAdminId },
      entity,
    );

    const response = await this.callPterodactyl(
      `servers/${server.ptAdminId}/unsuspend`,
      'POST',
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Pterodactyl API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    await this.jobRunService.logInfo(
      ctx,
      'Successfully unsuspended server via Pterodactyl API',
      {
        serverId: server.id,
        ptAdminId: server.ptAdminId,
        responseStatus: response.status,
      },
      entity,
    );
  }

  private callPterodactyl(
    path: string,
    method: 'POST' | 'DELETE',
  ): Promise<Response> {
    const pterodactylUrl = this.config.get<string>('PTERODACTYL_URL');
    const apiKey = this.config.get<string>('PTERODACTYL_API_KEY');

    return fetch(`${pterodactylUrl}/api/application/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });
  }
}
