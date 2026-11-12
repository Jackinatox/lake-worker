import {
  Injectable,
  LoggerService as NestLoggerService,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  LogLevel,
  LogSource,
  LogType,
  Prisma,
} from '../generated/prisma/client';
import { LogContext, LogContextService } from './log-context.service';
import { PrismaService } from './prisma.service';

/**
 * Second argument accepted by every log method.
 *
 * The reserved keys below set/override the resource attribution for this one
 * line. Any other key is folded into `details`, which keeps the existing call
 * sites (`logger.error(msg, { error, stack })`) working untouched.
 *
 * Note the category key is `logType`, not `type`: `type` is far too common a
 * payload key (`{ type: email.type }`) to steal from callers.
 */
export type LogOptions = Omit<LogContext, 'type'> & {
  /** Category, stored in Log.type. Defaults to SYSTEM. */
  logType?: LogType;
  details?: Record<string, unknown>;
  error?: unknown;
  /**
   * Rejected on purpose. `type` would otherwise be silently folded into
   * `details` and look like it had set the category column. Use `logType` for
   * the log category, or `details: { type }` for a domain value.
   */
  type?: never;
  [key: string]: unknown;
};

const RESERVED_KEYS = new Set([
  'gameServerId',
  'userId',
  'jobRunId',
  'logType',
  'component',
  'details',
]);

/** Ordering used for threshold filtering. Prisma's LogLevel has no DEBUG. */
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  [LogLevel.TRACE]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40,
  [LogLevel.FATAL]: 50,
};

const CONSOLE_COLOR: Record<LogLevel, string> = {
  [LogLevel.TRACE]: '\x1b[90m',
  [LogLevel.INFO]: '\x1b[32m',
  [LogLevel.WARN]: '\x1b[33m',
  [LogLevel.ERROR]: '\x1b[31m',
  [LogLevel.FATAL]: '\x1b[35m',
};
const COLOR_RESET = '\x1b[0m';

interface PendingLog {
  level: LogLevel;
  message: string;
  details: Record<string, unknown> | null;
  type: LogType;
  instanceId: string;
  component: string | null;
  jobRunId: string | null;
  gameServerId: string | null;
  userId: string | null;
  createdAt: Date;
}

const FLUSH_INTERVAL_MS = 1000;
const FLUSH_AT_SIZE = 100;
/** Hard cap so a database outage cannot grow the buffer without bound. */
const MAX_BUFFER = 10_000;

@Injectable()
export class LoggerService implements NestLoggerService, OnApplicationShutdown {
  private readonly instanceId = process.env.INSTANCE_ID ?? 'nest-lake-worker';
  private readonly threshold: LogLevel;
  private readonly warnOnUnattributed =
    process.env.NODE_ENV !== 'production' &&
    process.env.LOG_WARN_UNATTRIBUTED !== 'false';

  private buffer: PendingLog[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private dropped = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logContext: LogContextService,
  ) {
    this.threshold = parseThreshold(process.env.LOG_LEVEL);
  }

  // --- Nest LoggerService surface ------------------------------------------
  // Nest itself calls these with a string second argument (the class name);
  // application code calls them with a LogOptions object. Both are handled.

  log(message: unknown, options?: LogOptions | string): void {
    this.write(LogLevel.INFO, message, options);
  }

  error(message: unknown, options?: LogOptions | string): void {
    this.write(LogLevel.ERROR, message, options);
  }

  warn(message: unknown, options?: LogOptions | string): void {
    this.write(LogLevel.WARN, message, options);
  }

  /** Prisma's LogLevel has no DEBUG, so debug lines are stored as TRACE. */
  debug(message: unknown, options?: LogOptions | string): void {
    this.write(LogLevel.TRACE, message, options);
  }

  verbose(message: unknown, options?: LogOptions | string): void {
    this.write(LogLevel.TRACE, message, options);
  }

  fatal(message: unknown, options?: LogOptions | string): void {
    this.write(LogLevel.FATAL, message, options);
  }

  /** Explicit level, for callers that already hold a LogLevel value. */
  logAt(
    level: LogLevel,
    message: unknown,
    options?: LogOptions | string,
  ): void {
    this.write(level, message, options);
  }

  // --- core ----------------------------------------------------------------

  private write(
    level: LogLevel,
    rawMessage: unknown,
    options?: LogOptions | string,
  ): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.threshold]) return;

    const opts: LogOptions =
      typeof options === 'string' ? { component: options } : (options ?? {});

    const ambient = this.logContext.get();
    const { message, details } = normalize(rawMessage, opts);

    const entry: PendingLog = {
      level,
      message,
      details,
      type: opts.logType ?? ambient.type ?? LogType.SYSTEM,
      instanceId: this.instanceId,
      component: opts.component ?? ambient.component ?? null,
      jobRunId: opts.jobRunId ?? ambient.jobRunId ?? null,
      gameServerId: opts.gameServerId ?? ambient.gameServerId ?? null,
      userId: opts.userId ?? ambient.userId ?? null,
      createdAt: new Date(),
    };

    this.writeConsole(entry);

    if (
      this.warnOnUnattributed &&
      !entry.gameServerId &&
      !entry.userId &&
      !entry.jobRunId
    ) {
      process.stdout.write(
        `\x1b[33m[logger] unattributed log line (no gameServerId/userId/jobRunId): ${entry.message}\x1b[0m\n`,
      );
    }

    this.enqueue(entry);
  }

  private writeConsole(entry: PendingLog): void {
    const color = CONSOLE_COLOR[entry.level];
    const parts = [
      `${entry.createdAt.toISOString()}`,
      `${color}${entry.level.padEnd(5)}${COLOR_RESET}`,
    ];
    if (entry.component)
      parts.push(`\x1b[36m[${entry.component}]${COLOR_RESET}`);
    parts.push(entry.message);

    const tags: string[] = [];
    if (entry.gameServerId) tags.push(`server=${entry.gameServerId}`);
    if (entry.userId) tags.push(`user=${entry.userId}`);
    if (entry.jobRunId) tags.push(`jobRun=${entry.jobRunId}`);
    if (tags.length) parts.push(`\x1b[90m(${tags.join(' ')})${COLOR_RESET}`);

    if (entry.details) parts.push(safeStringify(entry.details));

    const line = parts.join(' ');
    if (
      entry.level === LogLevel.ERROR ||
      entry.level === LogLevel.FATAL ||
      entry.level === LogLevel.WARN
    ) {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }

  private enqueue(entry: PendingLog): void {
    if (this.buffer.length >= MAX_BUFFER) {
      this.dropped += 1;
      return;
    }
    this.buffer.push(entry);

    if (this.buffer.length >= FLUSH_AT_SIZE) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), FLUSH_INTERVAL_MS);
      // Do not hold the event loop open just for a pending flush.
      this.timer.unref?.();
    }
  }

  /** Persist everything buffered. Safe to call concurrently. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Serialize flushes so rows keep their insertion order.
    this.flushing = (this.flushing ?? Promise.resolve()).then(() =>
      this.doFlush(),
    );
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];

    if (this.dropped > 0) {
      const dropped = this.dropped;
      this.dropped = 0;
      this.reportInternal(
        `log buffer overflowed, dropped ${dropped} line(s) before persisting`,
      );
    }

    try {
      await this.prisma.log.createMany({
        data: batch.map(toCreateInput),
      });
    } catch {
      // A single bad row (most often a gameServerId/userId that was deleted
      // in the same transaction the line describes) fails the whole batch,
      // so fall back to per-row inserts to save the rest.
      await this.insertIndividually(batch);
    }
  }

  private async insertIndividually(batch: PendingLog[]): Promise<void> {
    for (const entry of batch) {
      try {
        await this.prisma.log.create({ data: toCreateInput(entry) });
      } catch {
        // Retry without the foreign keys: the resource is gone, but losing the
        // attribution is much better than losing the log line itself.
        try {
          await this.prisma.log.create({
            data: toCreateInput({
              ...entry,
              gameServerId: null,
              userId: null,
              details: {
                ...(entry.details ?? {}),
                _orphanedGameServerId: entry.gameServerId,
                _orphanedUserId: entry.userId,
              },
            }),
          });
        } catch (error) {
          this.reportInternal(
            `failed to persist log line: ${entry.message}`,
            error,
          );
        }
      }
    }
  }

  /** Console-only reporting; never recurses back into the database path. */
  private reportInternal(message: string, error?: unknown): void {
    const suffix = error ? ` (${describeError(error)})` : '';
    process.stderr.write(
      `\x1b[31m[logger] ${message}${suffix}${COLOR_RESET}\n`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flush();
  }
}

// --- helpers ---------------------------------------------------------------

/**
 * Prisma models a nullable Json column as `undefined`-or-value rather than
 * accepting `null` directly, so the absent case has to be dropped entirely.
 */
function toCreateInput(entry: PendingLog): Prisma.LogCreateManyInput {
  const { details, ...rest } = entry;
  // The `Log` table is shared with lake; `source` tells the two writers apart.
  const row = { ...rest, source: LogSource.WORKER };
  if (details === null) return row;
  // `normalize` already round-trips details through JSON, so the cast is a
  // formality: the value is known to be JSON-serializable at this point.
  return { ...row, details: details as Prisma.InputJsonValue };
}

function parseThreshold(raw?: string): LogLevel {
  switch (raw?.trim().toUpperCase()) {
    case 'TRACE':
    case 'DEBUG':
    case 'VERBOSE':
      return LogLevel.TRACE;
    case 'WARN':
      return LogLevel.WARN;
    case 'ERROR':
      return LogLevel.ERROR;
    case 'FATAL':
      return LogLevel.FATAL;
    default:
      return LogLevel.INFO;
  }
}

/**
 * Split the message out of whatever was passed, and fold the non-reserved
 * option keys into a single JSON-safe details object.
 */
function normalize(
  rawMessage: unknown,
  opts: LogOptions,
): { message: string; details: Record<string, unknown> | null } {
  const collected: Record<string, unknown> = {};

  if (rawMessage instanceof Error) {
    collected.stack = rawMessage.stack;
  }

  if (opts.details && typeof opts.details === 'object') {
    Object.assign(collected, opts.details);
  }
  for (const [key, value] of Object.entries(opts)) {
    if (RESERVED_KEYS.has(key) || value === undefined) continue;
    collected[key] = value;
  }
  if (collected.error !== undefined) {
    collected.error = serializeError(collected.error);
  }

  const message =
    rawMessage instanceof Error
      ? rawMessage.message
      : typeof rawMessage === 'string'
        ? rawMessage
        : safeStringify(rawMessage);

  const details = Object.keys(collected).length
    ? (JSON.parse(safeStringify(collected)) as Record<string, unknown>)
    : null;

  return { message, details };
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** JSON stringify that tolerates circular references, Errors and BigInt. */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (_key, val: unknown) => {
      if (val instanceof Error) return serializeError(val);
      if (typeof val === 'bigint') return val.toString();
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    }) ?? String(value)
  );
}
