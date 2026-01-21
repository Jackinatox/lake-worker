import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/core/prisma.service';
import { LoggerService } from 'src/core/logger.service';
import { Email, EmailStatus } from 'src/generated/prisma/client';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: Transporter;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: 465,
      secure: true,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
  }

  /**
   * Send an email from the queue
   */
  async sendEmail(email: Email): Promise<{ success: boolean; error?: string }> {
    const smtpUser = this.config.get<string>('SMTP_USER');

    try {
      const response = await this.transporter.sendMail({
        from: `"Scyed" <${smtpUser}>`,
        to: email.recipient,
        subject: email.subject,
        html: email.html,
      });

      // Update email status to SENT
      await this.prisma.email.update({
        where: { id: email.id },
        data: {
          status: EmailStatus.SENT,
          sentAt: new Date(),
          nodeMailerResponse: response as unknown as object,
        },
      });

      this.logger.log(`Email sent to ${email.recipient}`, {
        emailId: email.id,
        type: email.type,
        messageId: response.messageId,
      });

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Update email with error
      await this.prisma.email.update({
        where: { id: email.id },
        data: {
          status: EmailStatus.FAILED,
          retries: email.retries + 1,
          errorText: errorMessage,
        },
      });

      this.logger.error(`Failed to send email to ${email.recipient}`, {
        emailId: email.id,
        type: email.type,
        error: errorMessage,
        retryCount: email.retries + 1,
      });

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get pending emails for sending
   */
  async getPendingEmails(limit: number = 20): Promise<Email[]> {
    return this.prisma.email.findMany({
      where: {
        retries: { lt: 4 },
        status: { in: [EmailStatus.PENDING, EmailStatus.FAILED] },
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Count pending emails
   */
  async countPendingEmails(): Promise<number> {
    return this.prisma.email.count({
      where: {
        retries: { lt: 4 },
        status: { in: [EmailStatus.PENDING, EmailStatus.FAILED] },
      },
    });
  }

  /**
   * Create a new email record
   */
  async createEmail(data: {
    recipient: string;
    subject: string;
    html: string;
    type: Email['type'];
    gameServerId?: string;
    expiresAt?: Date;
  }): Promise<Email> {
    return this.prisma.email.create({
      data: {
        recipient: data.recipient,
        subject: data.subject,
        html: data.html,
        type: data.type,
        GameServerId: data.gameServerId,
        expiresAt: data.expiresAt,
      },
    });
  }
}
