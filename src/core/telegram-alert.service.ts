import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { LogLevel } from '../generated/prisma/client';
import {
  escapeHtml,
  TELEGRAM_MAX_LENGTH,
  TelegramClient,
} from './telegram.client';

/** The subset of a log line an alert needs. LoggerService's entry fits it. */
export interface AlertEntry {
  level: LogLevel;
  message: string;
  details: Record<string, unknown> | null;
  instanceId: string;
  component: string | null;
  jobRunId: string | null;
  gameServerId: string | null;
  userId: string | null;
  createdAt: Date;
}

/** Send once no new error has arrived for this long... */
const QUIET_MS = 3_000;
/** ...but never hold the first error back for longer than this. */
const MAX_WAIT_MS = 15_000;
/** FATAL lines go out almost immediately (the process may be going down). */
const FATAL_WAIT_MS = 500;
/** Minimum gap between two Telegram messages, so a flood stays readable. */
const COOLDOWN_MS = 5_000;
/** Lines beyond this per batch are only counted, not kept. */
const MAX_PENDING = 500;

/** Leave headroom below Telegram's limit for the footer. */
const BODY_BUDGET = TELEGRAM_MAX_LENGTH - 400;
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━';

const ICON: Partial<Record<LogLevel, string>> = {
  [LogLevel.FATAL]: '💀',
  [LogLevel.ERROR]: '🔴',
  [LogLevel.WARN]: '🟡',
};

interface Group {
  level: LogLevel;
  component: string | null;
  message: string;
  count: number;
  first: AlertEntry;
  gameServerIds: Set<string>;
}

/**
 * Forwards ERROR and FATAL log lines to Telegram.
 *
 * Lines that arrive close together are bundled into one message, and repeats
 * of the same line (same level, component and message) are collapsed into a
 * single row with a counter.
 */
@Injectable()
export class TelegramAlertService implements OnApplicationShutdown {
  private readonly enabled = process.env.TELEGRAM_ALERTS !== 'false';

  private pending: AlertEntry[] = [];
  private overflow = 0;
  private firstAt = 0;
  private lastSentAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private scheduledAt: number | null = null;
  private urgent = false;
  private sending: Promise<void> = Promise.resolve();

  constructor(private readonly telegram: TelegramClient) {}

  push(entry: AlertEntry): void {
    if (!this.enabled || !this.telegram.isConfigured) return;

    if (this.pending.length >= MAX_PENDING) {
      this.overflow += 1;
    } else {
      if (this.pending.length === 0) this.firstAt = Date.now();
      this.pending.push(entry);
    }
    this.schedule(entry.level === LogLevel.FATAL);
  }

  /** Send whatever is pending right now. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.scheduledAt = null;
    this.urgent = false;
    // Serialize so batches go out in order and never overlap.
    this.sending = this.sending.then(() => this.sendPending());
    return this.sending;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flush();
  }

  private schedule(urgent: boolean): void {
    const now = Date.now();
    if (urgent) this.urgent = true;

    let target = this.urgent
      ? // Once a FATAL is waiting, later lines may not push the send back.
        Math.min(this.scheduledAt ?? Infinity, now + FATAL_WAIT_MS)
      : Math.min(now + QUIET_MS, this.firstAt + MAX_WAIT_MS);
    target = Math.max(target, this.lastSentAt + COOLDOWN_MS);

    if (this.timer) clearTimeout(this.timer);
    this.scheduledAt = target;
    this.timer = setTimeout(() => void this.flush(), Math.max(0, target - now));
    this.timer.unref?.();
  }

  private async sendPending(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    const overflow = this.overflow;
    this.pending = [];
    this.overflow = 0;

    this.lastSentAt = Date.now();
    await this.telegram.send(render(batch, overflow));
  }
}

// --- rendering -------------------------------------------------------------

export function render(batch: AlertEntry[], overflow = 0): string {
  return batch.length === 1 && overflow === 0
    ? renderSingle(batch[0])
    : renderBatch(batch, overflow);
}

function renderSingle(entry: AlertEntry): string {
  const { error, stack, rest } = splitDetails(entry.details);

  const header =
    `${ICON[entry.level] ?? '⚪'} <b>${entry.level}</b>` +
    (entry.component ? ` · <code>${escapeHtml(entry.component)}</code>` : '');

  const lines = [
    header,
    DIVIDER,
    `<b>${escapeHtml(clip(entry.message, 600))}</b>`,
  ];

  const refs = resourceLines(entry);
  if (refs.length) lines.push('', ...refs);

  if (error && error !== entry.message) {
    lines.push(
      '',
      `<b>Error:</b> <code>${escapeHtml(clip(error, 500))}</code>`,
    );
  }

  const footer = [
    '',
    `🕒 ${formatTime(entry.createdAt)} · <code>${escapeHtml(entry.instanceId)}</code>`,
  ];

  // Optional blocks, dropped from the end until the message fits.
  const optional: string[][] = [];
  if (stack) {
    optional.push(['', '<b>Stack:</b>', pre(stackHead(stack))]);
  }
  if (rest) {
    optional.push(['', '<b>Details:</b>', pre(clip(prettyJson(rest), 1200))]);
  }

  while (optional.length) {
    const text = [...lines, ...optional.flat(), ...footer].join('\n');
    if (text.length <= TELEGRAM_MAX_LENGTH) return text;
    optional.pop();
  }
  return [...lines, ...footer].join('\n');
}

function renderBatch(batch: AlertEntry[], overflow: number): string {
  const groups = groupEntries(batch);
  const total = batch.length + overflow;
  const start = batch[0].createdAt;
  const end = batch[batch.length - 1].createdAt;

  const byLevel = new Map<LogLevel, number>();
  for (const e of batch) byLevel.set(e.level, (byLevel.get(e.level) ?? 0) + 1);
  const breakdown = [LogLevel.FATAL, LogLevel.ERROR, LogLevel.WARN]
    .filter((l) => byLevel.has(l))
    .map((l) => `${ICON[l]} ${byLevel.get(l)} ${l.toLowerCase()}`)
    .join(' · ');

  const span = end.getTime() - start.getTime();
  const lines = [
    `🚨 <b>${total} errors</b> in ${formatDuration(span)}`,
    breakdown,
    DIVIDER,
  ];

  let used = lines.join('\n').length;
  let shown = 0;
  for (const g of groups) {
    const block = renderGroup(g);
    if (used + block.length + 1 > BODY_BUDGET) break;
    lines.push(block);
    used += block.length + 1;
    shown += 1;
  }

  const hidden = groups.length - shown;
  if (hidden > 0) {
    lines.push(
      `<i>…and ${hidden} more distinct error${hidden === 1 ? '' : 's'}</i>`,
    );
  }
  if (overflow > 0) {
    lines.push(
      `<i>+${overflow} more line${overflow === 1 ? '' : 's'} dropped (flood)</i>`,
    );
  }

  lines.push(
    DIVIDER,
    `🕒 ${formatTime(start)} → ${formatTime(end, true)} · <code>${escapeHtml(batch[0].instanceId)}</code>`,
    '<i>Full details in the Log table.</i>',
  );
  return lines.join('\n');
}

function renderGroup(g: Group): string {
  const count = g.count > 1 ? ` <b>×${g.count}</b>` : '';
  const component = g.component
    ? ` <code>${escapeHtml(g.component)}</code>`
    : '';
  const head = `\n${ICON[g.level] ?? '⚪'}${count}${component}\n<b>${escapeHtml(clip(g.message, 200))}</b>`;

  const sub: string[] = [];
  const { error } = splitDetails(g.first.details);
  if (error && error !== g.message)
    sub.push(`↳ <code>${escapeHtml(clip(error, 200))}</code>`);

  const servers = [...g.gameServerIds];
  if (servers.length === 1) {
    sub.push(`↳ 🖥 <code>${escapeHtml(servers[0])}</code>`);
  } else if (servers.length > 1) {
    const list = servers
      .slice(0, 3)
      .map((s) => `<code>${escapeHtml(s)}</code>`)
      .join(', ');
    const more = servers.length > 3 ? ` +${servers.length - 3}` : '';
    sub.push(`↳ 🖥 ${servers.length} servers: ${list}${more}`);
  }

  return [head, ...sub].join('\n');
}

function groupEntries(batch: AlertEntry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const e of batch) {
    const key = `${e.level}\u0000${e.component ?? ''}\u0000${e.message}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        level: e.level,
        component: e.component,
        message: e.message,
        count: 0,
        first: e,
        gameServerIds: new Set(),
      };
      groups.set(key, g);
    }
    g.count += 1;
    if (e.gameServerId) g.gameServerIds.add(e.gameServerId);
  }

  const weight = (l: LogLevel) => (l === LogLevel.FATAL ? 0 : 1);
  return [...groups.values()].sort(
    (a, b) => weight(a.level) - weight(b.level) || b.count - a.count,
  );
}

// --- helpers ---------------------------------------------------------------

function resourceLines(e: AlertEntry): string[] {
  const out: string[] = [];
  if (e.gameServerId)
    out.push(`🖥 <b>Server:</b> <code>${escapeHtml(e.gameServerId)}</code>`);
  if (e.userId)
    out.push(`👤 <b>User:</b> <code>${escapeHtml(e.userId)}</code>`);
  if (e.jobRunId)
    out.push(`⚙️ <b>Job run:</b> <code>${escapeHtml(e.jobRunId)}</code>`);
  return out;
}

/**
 * Pull the error message and stack out of the logger's details object.
 * `error` is either a string or the `{ name, message, stack }` the logger
 * serializes Errors into; a top-level `stack` comes from logging an Error
 * directly or from call sites that pass `{ error, stack }`.
 */
function splitDetails(details: Record<string, unknown> | null): {
  error: string | null;
  stack: string | null;
  rest: Record<string, unknown> | null;
} {
  if (!details) return { error: null, stack: null, rest: null };
  const { error: rawError, stack: rawStack, ...rest } = details;

  let error: string | null = null;
  let stack: string | null = typeof rawStack === 'string' ? rawStack : null;

  if (typeof rawError === 'string') {
    error = rawError;
  } else if (rawError && typeof rawError === 'object') {
    const e = rawError as {
      name?: unknown;
      message?: unknown;
      stack?: unknown;
    };
    const name =
      typeof e.name === 'string' && e.name !== 'Error' ? `${e.name}: ` : '';
    error =
      typeof e.message === 'string'
        ? `${name}${e.message}`
        : prettyJson(rawError);
    if (!stack && typeof e.stack === 'string') stack = e.stack;
  } else if (rawError !== undefined && rawError !== null) {
    error = String(rawError as string | number | boolean);
  }

  return { error, stack, rest: Object.keys(rest).length ? rest : null };
}

/** The first few frames are what matter; node_modules frames rarely do. */
function stackHead(stack: string): string {
  const frames = stack
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at ') && !l.includes('node_modules'));
  return clip(frames.slice(0, 6).join('\n') || stack, 1200);
}

function pre(text: string): string {
  return `<pre>${escapeHtml(text)}</pre>`;
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatTime(d: Date, timeOnly = false): string {
  const iso = d.toISOString();
  const time = iso.slice(11, 19);
  return timeOnly ? `${time} UTC` : `${iso.slice(0, 10)} ${time} UTC`;
}

function formatDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
