# Logging

Every log line this worker emits is written to the `Log` table in the lake
database (with `source = WORKER`; lake writes its own lines there as `APP`), and
mirrored to the console for `docker logs`. There is no
OpenTelemetry/Tempo and no Loki any more — the database is the only sink.

## Writing a log line

Inject `LoggerService` (globally available via `CoreModule`) and log:

```ts
constructor(private readonly logger: LoggerService) {}

this.logger.log('Server provisioned', {
  component: MyService.name,
  logType: LogType.GAME_SERVER,
  ptServerId,                 // unknown keys land in `details`
});
```

Levels map onto the Prisma `LogLevel` enum. `debug()` and `verbose()` are both
stored as `TRACE`, because `LogLevel` has no `DEBUG` member.

The second argument accepts these **reserved** keys, which populate columns:

| Key            | Column         | Notes                                     |
| -------------- | -------------- | ----------------------------------------- |
| `gameServerId` | `gameServerId` | Overrides the ambient scope               |
| `userId`       | `userId`       | Overrides the ambient scope               |
| `jobRunId`     | `jobRunId`     | Links the line to a `JobRun` (its job type lives there) |
| `logType`      | `type`         | Category; `SYSTEM` when not set           |
| `component`    | `component`    | Emitting service/class name               |
| `details`      | `details`      | Explicit JSON payload                     |

Every other key is folded into `details`, so existing calls like
`logger.error(msg, { error, stack })` keep working.

> `type` is deliberately rejected by the type system. It would otherwise look
> like it set the category column while silently becoming a detail. Use
> `logType` for the category, or `details: { type }` for a domain value.

## Attribution: how every line gets a server and a user

The ids are **not** passed at each call site. They live in an
`AsyncLocalStorage` scope opened where they are actually known, and every line
logged inside that scope — however deep the call stack, across any number of
awaits — inherits them.

```ts
// Narrow to one server; ports/installation/email logs underneath inherit this.
await this.logContext.runForServer(
  { gameServerId: server.id, userId: server.userId },
  () => this.doWorkForServer(server),
);
```

`runForServer` requires both ids, which is what makes the guarantee
enforceable: the ids are demanded once, where they exist, instead of being an
optional argument on 140 individual log calls.

Scopes merge, so an inner scope can add a `gameServerId` without losing the
surrounding `jobRunId`. Inside a per-server loop, open the scope **per
iteration** so each server's lines are attributed to it rather than to the job
run as a whole.

Deep helpers (`PterodactylPortService`, `InstallationService`) take no ids at
all — they just add `component`/`logType` and inherit the rest.

In non-production, a line that lands with no `gameServerId`, `userId` or
`jobRunId` prints a `[logger] unattributed log line` warning. Set
`LOG_WARN_UNATTRIBUTED=false` to silence it.

## Persistence behaviour

- Lines are **buffered** and flushed every second, or at 100 lines. Console
  output is immediate, so nothing is delayed visually.
- `app.enableShutdownHooks()` in `main.ts` is what flushes the buffer on
  SIGTERM. Without it, the last second of lines is lost on container stop.
- If a batch insert fails, rows are retried individually; a row whose
  `gameServerId`/`userId` no longer exists (its server was just deleted) is
  re-inserted with the foreign keys nulled and the original ids preserved under
  `details._orphanedGameServerId` / `_orphanedUserId`. Losing the attribution
  beats losing the line.
- The buffer is capped at 10 000 lines so a database outage cannot grow it
  without bound; overflow is counted and reported to the console.

## Job runs

`JobRunService` still owns the `JobRun` lifecycle (`startJobRun`,
`completeJobRun`, `failJobRun`, `updateProgress`) and its own table/page. Its
`log`/`logInfo`/`logWarn`/`logError`/`logFatal` helpers now delegate to
`LoggerService` instead of writing `Log` rows themselves, so there is exactly
one write path. Their signatures are unchanged.

## Environment variables

| Variable                 | Default            | Purpose                                 |
| ------------------------ | ------------------ | --------------------------------------- |
| `INSTANCE_ID`            | `nest-lake-worker` | Written to `Log.instanceId`             |
| `LOG_LEVEL`              | `info`             | `trace`/`debug`, `info`, `warn`, `error`, `fatal` |
| `LOG_WARN_UNATTRIBUTED`  | enabled off-prod   | Set to `false` to silence the warning   |

## The shared `Log` table

`Log` holds lake's and the worker's lines in one table, told apart by `source`.
Lake owns the schema and runs every migration; this repo keeps an identical
copy of the datamodel in `prisma/schema.prisma` and only runs `prisma generate`.
Change a column in lake first, copy the model here, and deploy both together.
The request columns (`method`, `path`, `userAgent`, `ipAddress`) are lake-only
and stay null for worker lines. See lake's `docs/admin-log-viewer.md`.
