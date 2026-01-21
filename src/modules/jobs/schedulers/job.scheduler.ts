import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LoggerService } from 'src/core/logger.service';
import { ExpireServersService } from '../services/expire-servers.service';
import { DeleteServersService } from '../services/delete-servers.service';
import { SendEmailsService } from '../services/send-emails.service';
import { GenerateExpiryEmailsService } from '../services/generate-expiry-emails.service';
import { GenerateDeletionEmailsService } from '../services/generate-deletion-emails.service';
import { NotificationService } from '../services/notification.service';

@Injectable()
export class JobScheduler {
  private isRunning: Record<string, boolean> = {};

  constructor(
    private readonly logger: LoggerService,
    private readonly expireServers: ExpireServersService,
    private readonly deleteServers: DeleteServersService,
    private readonly sendEmails: SendEmailsService,
    private readonly generateExpiryEmails: GenerateExpiryEmailsService,
    private readonly generateDeletionEmails: GenerateDeletionEmailsService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Expire servers - runs every hour
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleExpireServers(): Promise<void> {
    await this.runJob('ExpireServers', async () => {
      const result = await this.expireServers.run();
      return {
        processed: result.processed,
        total: result.total,
        failed: result.failed,
      };
    });
  }

  /**
   * Delete servers - runs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleDeleteServers(): Promise<void> {
    await this.runJob('DeleteServers', async () => {
      const result = await this.deleteServers.run();
      return {
        processed: result.processed,
        total: result.total,
        failed: result.failed,
      };
    });
  }

  /**
   * Send emails - runs every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleSendEmails(): Promise<void> {
    await this.runJob('SendEmails', async () => {
      const result = await this.sendEmails.run();
      return {
        processed: result.processed,
        total: result.total,
        failed: result.failed,
      };
    });
  }

  /**
   * Generate expiry reminder emails - runs every day at 8:00 AM
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleGenerateExpiryEmails(): Promise<void> {
    await this.runJob('GenerateExpiryEmails', async () => {
      const result = await this.generateExpiryEmails.run();
      return {
        processed: result.processed,
        total: result.processed + result.failed,
        failed: result.failed,
      };
    });
  }

  /**
   * Generate deletion reminder emails - runs every day at 9:00 AM
   */
  @Cron('0 9 * * *')
  async handleGenerateDeletionEmails(): Promise<void> {
    await this.runJob('GenerateDeletionEmails', async () => {
      const result = await this.generateDeletionEmails.run();
      return {
        processed: result.processed,
        total: result.processed + result.failed,
        failed: result.failed,
      };
    });
  }

  /**
   * Run a job with locking and error handling
   */
  private async runJob(
    name: string,
    executor: () => Promise<{
      processed: number;
      total: number;
      failed: number;
    }>,
  ): Promise<void> {
    // Check if job is already running
    if (this.isRunning[name]) {
      this.logger.warn(`Job ${name} is already running, skipping this run`);
      return;
    }

    this.isRunning[name] = true;
    const startTime = Date.now();

    try {
      this.logger.log(`Starting job: ${name}`);
      const result = await executor();
      const duration = Date.now() - startTime;

      this.logger.log(`Job ${name} completed`, {
        processed: result.processed,
        total: result.total,
        failed: result.failed,
        duration,
      });

      // Notify on failures
      if (result.failed > 0) {
        await this.notifications.notifyJobComplete({
          jobType: name,
          processed: result.processed,
          total: result.total,
          failed: result.failed,
          duration,
        });
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Job ${name} failed`, {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        duration,
      });

      // Always notify on critical failures
      await this.notifications.notifyError({
        errorMessage: `Job ${name} failed: ${errorMessage}`,
        context: name,
        details: {
          duration,
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
    } finally {
      this.isRunning[name] = false;
    }
  }

  /**
   * Get status of all jobs for monitoring
   */
  getStatus(): Record<string, { isRunning: boolean }> {
    return {
      ExpireServers: { isRunning: this.isRunning['ExpireServers'] ?? false },
      DeleteServers: { isRunning: this.isRunning['DeleteServers'] ?? false },
      SendEmails: { isRunning: this.isRunning['SendEmails'] ?? false },
      GenerateExpiryEmails: {
        isRunning: this.isRunning['GenerateExpiryEmails'] ?? false,
      },
      GenerateDeletionEmails: {
        isRunning: this.isRunning['GenerateDeletionEmails'] ?? false,
      },
    };
  }

  /**
   * Manually trigger a job (for testing/admin purposes)
   */
  async triggerJob(
    jobName:
      | 'ExpireServers'
      | 'DeleteServers'
      | 'SendEmails'
      | 'GenerateExpiryEmails'
      | 'GenerateDeletionEmails',
  ): Promise<{
    success: boolean;
    result?: { processed: number; total: number; failed: number };
    error?: string;
  }> {
    try {
      let result: { processed: number; total: number; failed: number };

      switch (jobName) {
        case 'ExpireServers':
          result = await this.expireServers.run();
          break;
        case 'DeleteServers':
          result = await this.deleteServers.run();
          break;
        case 'SendEmails':
          result = await this.sendEmails.run();
          break;
        case 'GenerateExpiryEmails': {
          const expiryResult = await this.generateExpiryEmails.run();
          result = {
            processed: expiryResult.processed,
            total: expiryResult.processed + expiryResult.failed,
            failed: expiryResult.failed,
          };
          break;
        }
        case 'GenerateDeletionEmails': {
          const deletionResult = await this.generateDeletionEmails.run();
          result = {
            processed: deletionResult.processed,
            total: deletionResult.processed + deletionResult.failed,
            failed: deletionResult.failed,
          };
          break;
        }
      }

      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
