import { Injectable } from '@nestjs/common';
import { escapeHtml, TelegramClient } from 'src/core/telegram.client';

/**
 * Hand-written Telegram notifications (job summaries, new game versions).
 * ERROR/FATAL log lines are forwarded automatically by TelegramAlertService,
 * so there is no need to call anything here for those.
 */
@Injectable()
export class NotificationService {
  constructor(private readonly telegram: TelegramClient) {}

  private escapeHtml(text: string): string {
    return escapeHtml(text);
  }

  private sendTelegramMessage(message: string): Promise<boolean> {
    return this.telegram.send(message);
  }

  /**
   * Send notification about new game version
   */
  async notifyNewVersion(params: {
    gameName: string;
    oldVersion: string;
    newVersion: string;
    branch?: string;
  }): Promise<boolean> {
    const { gameName, oldVersion, newVersion, branch } = params;

    let text =
      `<b>🎮 New ${this.escapeHtml(gameName)} Version Available</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>Old Version:</b> <code>${this.escapeHtml(oldVersion)}</code>\n` +
      `<b>New Version:</b> <code>${this.escapeHtml(newVersion)}</code>\n`;

    if (branch) {
      text += `<b>Branch:</b> <code>${this.escapeHtml(branch)}</code>\n`;
    }

    return this.sendTelegramMessage(text);
  }

  /**
   * Send info notification
   */
  async notifyInfo(params: {
    title: string;
    message: string;
    details?: Record<string, string | number>;
  }): Promise<boolean> {
    const { title, message, details } = params;

    let text =
      `<b>ℹ️ ${this.escapeHtml(title)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${this.escapeHtml(message)}\n`;

    if (details && Object.keys(details).length > 0) {
      text += `\n`;
      for (const [key, value] of Object.entries(details)) {
        text += `<b>${this.escapeHtml(key)}:</b> <code>${this.escapeHtml(String(value))}</code>\n`;
      }
    }

    return this.sendTelegramMessage(text);
  }

  /**
   * Send job completion notification
   */
  async notifyJobComplete(params: {
    jobType: string;
    processed: number;
    total: number;
    failed: number;
    duration: number;
  }): Promise<boolean> {
    const { jobType, processed, total, failed, duration } = params;
    const status = failed > 0 ? '⚠️' : '✅';

    const text =
      `<b>${status} Job Completed: ${this.escapeHtml(jobType)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>Processed:</b> <code>${processed}/${total}</code>\n` +
      `<b>Failed:</b> <code>${failed}</code>\n` +
      `<b>Duration:</b> <code>${(duration / 1000).toFixed(2)}s</code>\n`;

    return this.sendTelegramMessage(text);
  }
}
