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
import { DELETE_GAMESERVER_AFTER_DAYS } from 'src/lib/GlobalConsstants';

@Injectable()
export class GenerateDeletionEmailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobRunService: JobRunService,
    private readonly emailService: EmailTransportService,
    private readonly templateService: EmailTemplateService,
  ) {}

  /**
   * Generate reminder emails for servers that are about to be deleted
   */
  async run(): Promise<{ processed: number; failed: number }> {
    const ctx = await this.jobRunService.startJobRun(
      WorkerJobType.GENERATE_DELETION_EMAILS,
    );

    let processed = 0;
    let failed = 0;
    const now = new Date();

    await this.jobRunService.logInfo(ctx, 'Job started');

    try {
      // Process 1-day deletion reminders
      const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const expiryThreshold1DayMin = new Date(
        now.getTime() -
          (DELETE_GAMESERVER_AFTER_DAYS - 1) * 24 * 60 * 60 * 1000,
      );
      const expiryThreshold1DayMax = new Date(
        twoDaysFromNow.getTime() -
          DELETE_GAMESERVER_AFTER_DAYS * 24 * 60 * 60 * 1000,
      );

      const deleting1day = await this.prisma.gameServer.findMany({
        where: {
          expires: { lte: expiryThreshold1DayMax, gte: expiryThreshold1DayMin },
          status: GameServerStatus.EXPIRED,
          Email: { none: { type: EmailType.GAME_SERVER_DELETION_1_DAY } },
        },
        include: { user: true },
        orderBy: { expires: 'asc' },
      });

      for (const server of deleting1day) {
        try {
          const deletionDate = new Date(server.expires);
          deletionDate.setDate(
            deletionDate.getDate() + DELETE_GAMESERVER_AFTER_DAYS,
          );
          await this.createDeletionEmail(server, 1, deletionDate);
          processed++;
        } catch (error) {
          failed++;
          await this.jobRunService.logError(
            ctx,
            'Failed to generate 1-day deletion email',
            {
              serverId: server.id,
              error: error instanceof Error ? error.message : String(error),
            },
            { gameServerId: server.id, userId: server.userId },
          );
        }
      }

      // Process 7-day deletion reminders
      const sixDaysFromNow = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
      const eightDaysFromNow = new Date(
        now.getTime() + 8 * 24 * 60 * 60 * 1000,
      );
      const expiryThreshold7DayMin = new Date(
        sixDaysFromNow.getTime() -
          DELETE_GAMESERVER_AFTER_DAYS * 24 * 60 * 60 * 1000,
      );
      const expiryThreshold7DayMax = new Date(
        eightDaysFromNow.getTime() -
          DELETE_GAMESERVER_AFTER_DAYS * 24 * 60 * 60 * 1000,
      );

      const deleting7days = await this.prisma.gameServer.findMany({
        where: {
          expires: { lte: expiryThreshold7DayMax, gte: expiryThreshold7DayMin },
          status: GameServerStatus.EXPIRED,
          Email: { none: { type: EmailType.GAME_SERVER_DELETION_7_DAYS } },
        },
        include: { user: true },
        orderBy: { expires: 'asc' },
      });

      for (const server of deleting7days) {
        try {
          const deletionDate = new Date(server.expires);
          deletionDate.setDate(
            deletionDate.getDate() + DELETE_GAMESERVER_AFTER_DAYS,
          );
          await this.createDeletionEmail(server, 7, deletionDate);
          processed++;
        } catch (error) {
          failed++;
          await this.jobRunService.logError(
            ctx,
            'Failed to generate 7-day deletion email',
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
        total: deleting1day.length + deleting7days.length,
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

  private async createDeletionEmail(
    server: {
      id: string;
      name: string;
      expires: Date;
      ptServerId: string | null;
      user: { name: string; email: string };
    },
    days: 1 | 7,
    deletionDate: Date,
  ): Promise<void> {
    if (!server.ptServerId) {
      throw new Error(`Server ${server.id} has no Pterodactyl server ID`);
    }

    const emailType =
      days === 1
        ? EmailType.GAME_SERVER_DELETION_1_DAY
        : EmailType.GAME_SERVER_DELETION_7_DAYS;

    const html = await this.templateService.renderDeletionEmail({
      username: server.user.name,
      serverName: server.name,
      expirationDate: server.expires,
      deletionDate,
      deletionDays: days,
      serverId: server.ptServerId,
    });

    await this.emailService.createEmail({
      recipient: server.user.email,
      subject: 'Dein Server wird bald gelöscht',
      html,
      type: emailType,
      gameServerId: server.id,
      expiresAt: deletionDate,
    });
  }
}
