import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/core/prisma.service';
import {
  WorkerJobType,
  EmailType,
  GameServerStatus,
} from 'src/generated/prisma/client';
import { JobRunService } from '../services/job-run.service';
import { EmailTransportService } from './emailTransport.service';
import { EmailTemplateService } from '../services/email-template.service';
import { DELETE_GAMESERVER_AFTER_DAYS } from '../constants/worker.constants';

@Injectable()
export class GenerateExpiryEmailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobRunService: JobRunService,
    private readonly emailService: EmailTransportService,
    private readonly templateService: EmailTemplateService,
  ) {}

  /**
   * Generate reminder emails for servers that are about to expire
   */
  async run(): Promise<{ processed: number; failed: number }> {
    const ctx = await this.jobRunService.startJobRun(
      WorkerJobType.GENERATE_EMAILS,
    );

    let processed = 0;
    let failed = 0;
    const now = new Date();

    await this.jobRunService.logInfo(ctx, 'Job started');

    try {
      // Process 1-day expiry reminders
      const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const expiring1day = await this.prisma.gameServer.findMany({
        where: {
          expires: { lte: twoDaysFromNow, gt: now },
          status: {
            notIn: [
              GameServerStatus.EXPIRED,
              GameServerStatus.DELETED,
              GameServerStatus.CREATION_FAILED,
            ],
          },
          Email: { none: { type: EmailType.GAME_SERVER_EXPIRING_1_DAY } },
        },
        include: { user: true },
        orderBy: { expires: 'asc' },
      });

      for (const server of expiring1day) {
        try {
          await this.createExpiryEmail(server, 1);
          processed++;
        } catch (error) {
          failed++;
          await this.jobRunService.logError(
            ctx,
            'Failed to generate 1-day expiry email',
            {
              serverId: server.id,
              error: error instanceof Error ? error.message : String(error),
            },
            { gameServerId: server.id, userId: server.userId },
          );
        }
      }

      // Process 7-day expiry reminders
      const sixDaysFromNow = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
      const eightDaysFromNow = new Date(
        now.getTime() + 8 * 24 * 60 * 60 * 1000,
      );
      const expiring7days = await this.prisma.gameServer.findMany({
        where: {
          expires: { lte: eightDaysFromNow, gte: sixDaysFromNow },
          status: {
            notIn: [
              GameServerStatus.EXPIRED,
              GameServerStatus.DELETED,
              GameServerStatus.CREATION_FAILED,
            ],
          },
          Email: { none: { type: EmailType.GAME_SERVER_EXPIRING_7_DAYS } },
        },
        include: { user: true },
        orderBy: { expires: 'asc' },
      });

      for (const server of expiring7days) {
        try {
          await this.createExpiryEmail(server, 7);
          processed++;
        } catch (error) {
          failed++;
          await this.jobRunService.logError(
            ctx,
            'Failed to generate 7-day expiry email',
            {
              serverId: server.id,
              error: error instanceof Error ? error.message : String(error),
            },
            { gameServerId: server.id, userId: server.userId },
          );
        }
      }

      await this.jobRunService.completeJobRun(ctx.jobRunId, {
        processed,
        total: expiring1day.length + expiring7days.length,
        failed,
      });

      return { processed, failed };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await this.jobRunService.failJobRun(ctx.jobRunId, err, {
        processed,
        total: 0,
        failed,
      });
      throw error;
    }
  }

  private async createExpiryEmail(
    server: {
      id: string;
      name: string;
      expires: Date;
      ptServerId: string | null;
      type: string;
      user: { name: string; email: string };
    },
    days: 1 | 7,
  ): Promise<void> {
    if (!server.ptServerId) {
      throw new Error(`Server ${server.id} has no Pterodactyl server ID`);
    }

    const deleteDate = new Date(server.expires);
    deleteDate.setDate(deleteDate.getDate() + DELETE_GAMESERVER_AFTER_DAYS);

    const emailType =
      days === 1
        ? EmailType.GAME_SERVER_EXPIRING_1_DAY
        : EmailType.GAME_SERVER_EXPIRING_7_DAYS;

    const html = await this.templateService.renderExpiryEmail({
      username: server.user.name,
      serverName: server.name,
      expirationDate: server.expires,
      deleteDate,
      expirationDays: days,
      serverId: server.ptServerId,
      isFreeServer: server.type === 'FREE',
    });

    await this.emailService.createEmail({
      recipient: server.user.email,
      subject: 'Dein Server läuft bald ab',
      html,
      type: emailType,
      gameServerId: server.id,
      expiresAt: server.expires,
    });
  }
}
