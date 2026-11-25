import { Injectable } from '@nestjs/common';

/** Telegram rejects messages longer than this (after entity parsing). */
export const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Bare Telegram Bot API sender, shared by the job notifications and the
 * error alerts.
 *
 * It deliberately does not depend on LoggerService: the logger forwards
 * ERROR/FATAL lines here, so reporting a failed send through the logger would
 * feed straight back into another send. Failures go to stderr only.
 */
@Injectable()
export class TelegramClient {
  /** Read lazily so ConfigModule has populated process.env by first use. */
  private get botToken(): string | undefined {
    return process.env.TELEGRAM_BOT_TOKEN || undefined;
  }

  private get chatId(): string | undefined {
    return process.env.TELEGRAM_CHAT_ID || undefined;
  }

  get isConfigured(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  /** Send an HTML-formatted message. Resolves false instead of throwing. */
  async send(html: string): Promise<boolean> {
    if (!this.isConfigured) {
      report('credentials missing, message skipped');
      return false;
    }

    // One retry when Telegram asks us to slow down.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${this.botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: this.chatId,
              text: html,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );

        if (res.ok) return true;

        const body = await res.text();
        const retryAfter = parseRetryAfter(body);
        if (res.status === 429 && retryAfter !== null && attempt === 0) {
          await sleep(Math.min(retryAfter, 60) * 1000);
          continue;
        }
        report(`API error ${res.status}: ${body}`);
        return false;
      } catch (error) {
        report(
          `send failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    }
    return false;
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseRetryAfter(body: string): number | null {
  try {
    const parsed = JSON.parse(body) as {
      parameters?: { retry_after?: number };
    };
    return parsed.parameters?.retry_after ?? null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function report(message: string): void {
  process.stderr.write(`\x1b[31m[telegram] ${message}\x1b[0m\n`);
}
