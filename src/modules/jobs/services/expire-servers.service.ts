import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/core/prisma.service';
import { GameServerStatus } from 'src/generated/prisma/client';
import { JobRunService, JobContext } from '../services/job-run.service';
import { WorkerJobType } from 'src/generated/prisma/client';
import { DEFAULT_BATCH_SIZE } from 'src/lib/GlobalConsstants';

@Injectable()
export class ExpireServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jobRunService: JobRunService,
  ) {}

  /**
   * Find and expire servers that have passed their expiration date
   */
  async run(): Promise<{ processed: number; total: number; failed: number }> {
    const ctx = await this.jobRunService.startJobRun(
      WorkerJobType.EXPIRE_SERVERS,
    );

    let processed = 0;
    let failed = 0;
    const now = new Date();

    // Count total servers to process
    const total = await this.prisma.gameServer.count({
      where: {
        expires: { lte: now },
        status: {
          notIn: [
            GameServerStatus.EXPIRED,
            GameServerStatus.DELETED,
            GameServerStatus.CREATION_FAILED,
          ],
        },
      },
    });

    await this.jobRunService.logInfo(
      ctx,
      `Job started, processing ${total} servers`,
      {
        totalServers: total,
      },
    );

    try {
      while (true) {
        const expiring = await this.prisma.gameServer.findMany({
          where: {
            expires: { lte: now },
            status: {
              notIn: [
                GameServerStatus.EXPIRED,
                GameServerStatus.DELETED,
                GameServerStatus.CREATION_FAILED,
              ],
            },
          },
          take: DEFAULT_BATCH_SIZE,
          orderBy: { expires: 'asc' },
        });

        if (expiring.length === 0) break;

        for (const server of expiring) {
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
      'Starting to handle expired server',
      {
        serverId: server.id,
        expires: server.expires.toISOString(),
        currentStatus: server.status,
      },
      { gameServerId: server.id, userId: server.userId },
    );

    // Suspend server via Pterodactyl API
    await this.suspendServer(server, ctx);

    // Update status in database
    await this.prisma.gameServer.update({
      where: { id: server.id },
      data: { status: GameServerStatus.EXPIRED },
    });

    await this.jobRunService.logInfo(
      ctx,
      'Server marked as EXPIRED in database',
      { serverId: server.id, newStatus: 'EXPIRED' },
      { gameServerId: server.id, userId: server.userId },
    );
  }

  private async suspendServer(
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
      'Suspending server via Pterodactyl API',
      { serverId: server.id, ptAdminId: server.ptAdminId },
      { gameServerId: server.id, userId: server.userId },
    );

    const response = await fetch(
      `${pterodactylUrl}/api/application/servers/${server.ptAdminId}/suspend`,
      {
        method: 'POST',
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
      'Successfully suspended server via Pterodactyl API',
      {
        serverId: server.id,
        ptAdminId: server.ptAdminId,
        responseStatus: response.status,
      },
      { gameServerId: server.id, userId: server.userId },
    );
  }
}
