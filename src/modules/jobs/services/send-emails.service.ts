import { Injectable } from '@nestjs/common';
import { WorkerJobType } from 'src/generated/prisma/client';
import { JobRunService } from '../services/job-run.service';
import { EmailTransportService } from './emailTransport.service';
import {
  DEFAULT_BATCH_SIZE,
  EMAIL_THROTTLE_MS,
} from 'src/lib/GlobalConsstants';

@Injectable()
export class SendEmailsService {
  constructor(
    private readonly jobRunService: JobRunService,
    private readonly emailService: EmailTransportService,
  ) {}

  /**
   * Process and send pending emails from the queue
   */
  async run(): Promise<{ processed: number; total: number; failed: number }> {
    const ctx = await this.jobRunService.startJobRun(WorkerJobType.SEND_EMAILS);

    let processed = 0;
    let failed = 0;

    // Count total emails to process
    const total = await this.emailService.countPendingEmails();

    await this.jobRunService.logInfo(
      ctx,
      `Job started, sending ${total} emails`,
      {
        totalEmails: total,
      },
    );

    try {
      while (true) {
        const emails =
          await this.emailService.getPendingEmails(DEFAULT_BATCH_SIZE);

        if (emails.length === 0) break;

        for (const email of emails) {
          const result = await this.emailService.sendEmail(email);

          if (result.success) {
            processed++;
          } else {
            failed++;
            await this.jobRunService.logError(ctx, 'Failed to send email', {
              emailId: email.id,
              type: email.type,
              recipient: email.recipient,
              error: result.error,
            });
          }

          await this.jobRunService.updateProgress(
            ctx.jobRunId,
            processed,
            total,
            failed,
          );

          // Throttle to not overwhelm the email service
          await this.delay(EMAIL_THROTTLE_MS);
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
