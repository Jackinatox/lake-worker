import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/core/prisma.service';
import { GameServerStatus, WorkerJobType } from 'src/generated/prisma/client';
import { JobRunService, JobContext } from '../services/job-run.service';
import {
  DEFAULT_BATCH_SIZE,
  DELETE_GAMESERVER_AFTER_DAYS,
} from '../constants/worker.constants';

@Injectable()
export class DeleteServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jobRunService: JobRunService,
  ) {}

  /**
   * Find and delete servers that have been expired for longer than the retention period
   */
  async run(): Promise<{ processed: number; total: number; failed: number }> {
    const ctx = await this.jobRunService.startJobRun(
      WorkerJobType.DELETE_SERVERS,
      {
        deletionThresholdDays: DELETE_GAMESERVER_AFTER_DAYS,
      },
    );

    let processed = 0;
    let failed = 0;
    const now = new Date();
    const deletionThreshold = new Date(
      now.getTime() - DELETE_GAMESERVER_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );

    // Count total servers to process
    const total = await this.prisma.gameServer.count({
      where: {
        expires: { lte: deletionThreshold },
        status: GameServerStatus.EXPIRED,
      },
    });

    await this.jobRunService.logInfo(
      ctx,
      `Job started, processing ${total} servers`,
      {
        totalServers: total,
        deletionThreshold: deletionThreshold.toISOString(),
      },
    );

    try {
      while (true) {
        const toDelete = await this.prisma.gameServer.findMany({
          where: {
            expires: { lte: deletionThreshold },
            status: GameServerStatus.EXPIRED,
          },
          take: DEFAULT_BATCH_SIZE,
          orderBy: { expires: 'asc' },
        });

        if (toDelete.length === 0) break;

        for (const server of toDelete) {
          try {
            await this.processServer(server, ctx);
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
              'Failed to process individual server',
              {
                serverId: server.id,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
              },
              { gameServerId: server.id, userId: server.userId },
            );
          }
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

  private async processServer(
    server: {
      id: string;
      userId: string;
      ptAdminId: number | null;
      ptServerId: string | null;
      expires: Date;
      status: string;
    },
    ctx: JobContext,
  ): Promise<void> {
    await this.jobRunService.logInfo(
      ctx,
      'Starting to handle server deletion',
      {
        serverId: server.id,
        expires: server.expires.toISOString(),
        currentStatus: server.status,
      },
      { gameServerId: server.id, userId: server.userId },
    );

    // Delete server via Pterodactyl API
    await this.deleteServer(server, ctx);

    // Update status in database
    await this.prisma.gameServer.update({
      where: { id: server.id },
      data: { status: GameServerStatus.DELETED },
    });

    await this.jobRunService.logInfo(
      ctx,
      'Server marked as DELETED in database',
      { serverId: server.id, newStatus: 'DELETED' },
      { gameServerId: server.id, userId: server.userId },
    );
  }

  private async deleteServer(
    server: {
      id: string;
      userId: string;
      ptAdminId: number | null;
      ptServerId: string | null;
    },
    ctx: JobContext,
  ): Promise<void> {
    if (!server.ptAdminId || !server.ptServerId) {
      throw new Error(`Missing Pterodactyl IDs for server ${server.id}`);
    }

    const pterodactylUrl = this.config.get<string>(
      'NEXT_PUBLIC_PTERODACTYL_URL',
    );
    const apiKey = this.config.get<string>('PTERODACTYL_API_KEY');

    await this.jobRunService.logInfo(
      ctx,
      'Deleting server via Pterodactyl API',
      { serverId: server.id, ptAdminId: server.ptAdminId },
      { gameServerId: server.id, userId: server.userId },
    );

    const response = await fetch(
      `${pterodactylUrl}/api/application/servers/${server.ptAdminId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Pterodactyl API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    await this.jobRunService.logInfo(
      ctx,
      'Successfully deleted server via Pterodactyl API',
      {
        serverId: server.id,
        ptAdminId: server.ptAdminId,
        responseStatus: response.status,
      },
      { gameServerId: server.id, userId: server.userId },
    );
  }
}
