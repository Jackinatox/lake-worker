import type { Provider } from '@nestjs/common';
import { LogContextService } from '../log-context.service';
import { LoggerService } from '../logger.service';

/**
 * Drop-in providers for unit tests.
 *
 * LoggerService writes to the database, so tests get a no-op double. The real
 * LogContextService is used because it is dependency-free and AsyncLocalStorage
 * behaviour is usually what a test wants to exercise.
 */
export const loggingTestProviders: Provider[] = [
  {
    provide: LoggerService,
    useValue: {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      fatal: jest.fn(),
      logAt: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
    },
  },
  LogContextService,
];
