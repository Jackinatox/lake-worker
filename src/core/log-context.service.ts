import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { LogType } from '../generated/prisma/client';

/**
 * Ambient context attached to every log line emitted inside a scope.
 *
 * Nothing here is passed explicitly at the ~140 call sites. Instead a scope is
 * opened at the few places that actually know these ids (job loops, the
 * provisioning processor, controllers) and every log line underneath — however
 * deep in the call stack, across any number of awaits — inherits it.
 */
export interface LogContext {
  /** Game server the line is about. Maps to Log.gameServerId. */
  gameServerId?: string;
  /** Owning user. Maps to Log.userId. */
  userId?: string;
  /** Scheduled job run this line belongs to, if any. Its job type lives on `JobRun`. */
  jobRunId?: string;
  /** Category (`Log.type`). Lines without one are stored as SYSTEM. */
  type?: LogType;
  /** Emitting service/class name, e.g. "PterodactylPortService". */
  component?: string;
}

/**
 * A scope that is guaranteed to identify a game server and its owner.
 *
 * Requiring both ids here is what makes "every log line has a server and a
 * user" enforceable at compile time: the ids are demanded once, at the point
 * where they are genuinely in scope, rather than being an optional argument on
 * every individual log call that callers can quietly forget.
 */
export interface ServerScope {
  gameServerId: string;
  userId: string;
}

@Injectable()
export class LogContextService {
  private readonly storage = new AsyncLocalStorage<LogContext>();

  /** Context for the currently executing async scope, if any. */
  get(): LogContext {
    return this.storage.getStore() ?? {};
  }

  /**
   * Run `fn` with `context` merged over whatever is already active.
   *
   * Merging (rather than replacing) means an inner scope can add a
   * `gameServerId` without losing the surrounding `jobRunId`, and a nested
   * scope can narrow to a different server without the outer one leaking in.
   */
  run<T>(context: LogContext, fn: () => T): T {
    const merged: LogContext = { ...this.get(), ...stripUndefined(context) };
    return this.storage.run(merged, fn);
  }

  /**
   * Scope every log line inside `fn` to a specific game server and its owner.
   *
   * Use this inside per-server loops so each iteration attributes its lines to
   * the right resource instead of to the job run as a whole.
   */
  runForServer<T>(
    scope: ServerScope,
    fn: () => T,
    extra?: Omit<LogContext, 'gameServerId' | 'userId'>,
  ): T {
    return this.run({ ...extra, ...scope }, fn);
  }

  /** Attach a component (service/class) name to everything logged inside. */
  runForComponent<T>(component: string, fn: () => T): T {
    return this.run({ component }, fn);
  }

  /** True when the active scope can attribute a line to a resource or job run. */
  hasAttribution(): boolean {
    const ctx = this.get();
    return Boolean(ctx.gameServerId ?? ctx.userId ?? ctx.jobRunId);
  }
}

function stripUndefined(context: LogContext): LogContext {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) out[key] = value;
  }
  return out as LogContext;
}
