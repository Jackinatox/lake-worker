import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from 'src/core/logger.service';

@Injectable()
export class NotificationService {
  private readonly botToken: string | undefined;
  private readonly chatId: string | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    this.chatId = this.config.get<string>('TELEGRAM_CHAT_ID');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private async sendTelegramMessage(message: string): Promise<boolean> {
    if (!this.botToken || !this.chatId) {
      this.logger.warn('Telegram credentials missing - notification skipped');
      return false;
    }

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: 'HTML',
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.error(`Telegram API error: ${res.status} - ${body}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Telegram notification failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
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
   * Send error notification
   */
  async notifyError(params: {
    errorMessage: string;
    context?: string;
    details?: Record<string, unknown>;
  }): Promise<boolean> {
    const { errorMessage, context, details } = params;

    let text =
      `<b>⚠️ Worker Error</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>Message:</b> ${this.escapeHtml(errorMessage)}\n`;

    if (context) {
      text += `<b>Context:</b> <code>${this.escapeHtml(context)}</code>\n`;
    }

    if (details && Object.keys(details).length > 0) {
      text += `\n<b>Details:</b>\n`;
      for (const [key, value] of Object.entries(details)) {
        if (value !== undefined && value !== null) {
          const valueStr =
            typeof value === 'object'
              ? JSON.stringify(value, null, 2)
              : String(value);
          const displayValue =
            valueStr.length > 300
              ? valueStr.substring(0, 300) + '...'
              : valueStr;
          text += `  • <b>${this.escapeHtml(key)}:</b> <code>${this.escapeHtml(displayValue)}</code>\n`;
        }
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
