import { LogLevel, LogType } from '../generated/prisma/client';
import { LogContextService } from './log-context.service';
import { LoggerService } from './logger.service';
import type { PrismaService } from './prisma.service';

interface Row {
  level: LogLevel;
  message: string;
  gameServerId: string | null;
  userId: string | null;
  jobRunId: string | null;
  component: string | null;
  type: LogType | null;
  details: Record<string, unknown> | null;
}

describe('LoggerService', () => {
  let rows: Row[];
  let createMany: jest.Mock;
  let create: jest.Mock;
  let logger: LoggerService;
  let logContext: LogContextService;
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    rows = [];
    createMany = jest.fn(({ data }: { data: Row[] }) => {
      rows.push(...data);
      return Promise.resolve({ count: data.length });
    });
    create = jest.fn(({ data }: { data: Row }) => {
      rows.push(data);
      return Promise.resolve(data);
    });

    // Keep test output readable; the console path is exercised either way.
    stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);

    const prisma = {
      log: { createMany, create },
    } as unknown as PrismaService;

    logContext = new LogContextService();
    logger = new LoggerService(prisma, logContext);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it('attributes a line to the server and user of the surrounding scope', async () => {
    await logContext.runForServer(
      { gameServerId: 'srv_1', userId: 'usr_1' },
      async () => {
        logger.log('provisioned');
        await logger.flush();
      },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      message: 'provisioned',
      gameServerId: 'srv_1',
      userId: 'usr_1',
      level: LogLevel.INFO,
    });
  });

  it('inherits the scope across await boundaries and nested calls', async () => {
    const deeplyNestedHelper = async () => {
      await Promise.resolve();
      logger.warn('deep line');
    };

    await logContext.runForServer(
      { gameServerId: 'srv_2', userId: 'usr_2' },
      async () => {
        await Promise.resolve();
        await deeplyNestedHelper();
      },
    );
    await logger.flush();

    expect(rows[0]).toMatchObject({
      message: 'deep line',
      gameServerId: 'srv_2',
      userId: 'usr_2',
      level: LogLevel.WARN,
    });
  });

  it('merges nested scopes so an inner server keeps the outer job run', async () => {
    await logContext.run({ jobRunId: 'run_1' }, async () => {
      logContext.runForServer({ gameServerId: 'srv_3', userId: 'usr_3' }, () =>
        logger.log('per-server line'),
      );
      await logger.flush();
    });

    expect(rows[0]).toMatchObject({
      jobRunId: 'run_1',
      gameServerId: 'srv_3',
      userId: 'usr_3',
    });
  });

  it('keeps sibling scopes isolated from each other', async () => {
    await logContext.run({ jobRunId: 'run_2' }, async () => {
      for (const id of ['srv_a', 'srv_b']) {
        logContext.runForServer({ gameServerId: id, userId: `usr_${id}` }, () =>
          logger.log(`line for ${id}`),
        );
      }
      await logger.flush();
    });

    expect(rows.map((r) => r.gameServerId)).toEqual(['srv_a', 'srv_b']);
    expect(rows.every((r) => r.jobRunId === 'run_2')).toBe(true);
  });

  it('lets an explicit option override the ambient scope', async () => {
    await logContext.runForServer(
      { gameServerId: 'srv_amb', userId: 'usr_amb' },
      async () => {
        logger.log('explicit wins', { gameServerId: 'srv_explicit' });
        await logger.flush();
      },
    );

    expect(rows[0]).toMatchObject({
      gameServerId: 'srv_explicit',
      userId: 'usr_amb',
    });
  });

  it('folds unknown keys into details and maps logType to the type column', async () => {
    logger.error('boom', {
      component: 'MyService',
      logType: LogType.GAME_SERVER,
      ptServerId: 'pt_9',
      error: new Error('inner failure'),
    });
    await logger.flush();

    expect(rows[0]).toMatchObject({
      component: 'MyService',
      type: LogType.GAME_SERVER,
      level: LogLevel.ERROR,
    });
    expect(rows[0].details).toMatchObject({ ptServerId: 'pt_9' });
    expect(rows[0].details?.error).toMatchObject({ message: 'inner failure' });
  });

  it('stores debug and verbose as TRACE when the threshold allows it', async () => {
    process.env.LOG_LEVEL = 'debug';
    const traceLogger = new LoggerService(
      { log: { createMany, create } } as unknown as PrismaService,
      logContext,
    );
    delete process.env.LOG_LEVEL;

    traceLogger.debug('a debug line');
    await traceLogger.flush();

    expect(rows[0]).toMatchObject({
      message: 'a debug line',
      level: LogLevel.TRACE,
    });
  });

  it('drops lines below the configured threshold', async () => {
    logger.debug('should not persist');
    await logger.flush();

    expect(rows).toHaveLength(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('survives a circular details payload', async () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;

    logger.log('circular', { details: circular });
    await logger.flush();

    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({ name: 'loop' });
  });

  it('retries without foreign keys when the referenced server is gone', async () => {
    createMany.mockRejectedValueOnce(new Error('FK violation'));
    create.mockRejectedValueOnce(new Error('FK violation'));

    await logContext.runForServer(
      { gameServerId: 'deleted_srv', userId: 'deleted_usr' },
      async () => {
        logger.log('server deleted');
        await logger.flush();
      },
    );

    // Last write wins: attribution dropped, original ids kept in details.
    const saved = rows[rows.length - 1];
    expect(saved.gameServerId).toBeNull();
    expect(saved.userId).toBeNull();
    expect(saved.details).toMatchObject({
      _orphanedGameServerId: 'deleted_srv',
      _orphanedUserId: 'deleted_usr',
    });
  });

  it('flushes buffered lines on application shutdown', async () => {
    logger.log('pending at shutdown');
    expect(rows).toHaveLength(0);

    await logger.onApplicationShutdown();

    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('pending at shutdown');
  });

  it('treats a bare string second argument as the component (Nest calls it this way)', async () => {
    logger.log('nest style', 'SomeNestContext');
    await logger.flush();

    expect(rows[0]).toMatchObject({ component: 'SomeNestContext' });
  });
});
