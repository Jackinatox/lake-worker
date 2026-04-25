import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { LoggerService } from './core/logger.service';

@Injectable()
export class AppService {
  private packageVersion?: string;

  constructor(private readonly logger: LoggerService) {}

  getHello(): string {
    this.logger.log('getHello endpoint called');
    return 'Hello World!';
  }

  getVersion(): string {
    if (this.packageVersion) {
      return this.packageVersion;
    }

    try {
      const packageJson = JSON.parse(
        readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
      ) as { version?: string };

      if (!packageJson.version) {
        throw new Error('package.json does not contain a version');
      }

      this.packageVersion = packageJson.version;
      return this.packageVersion;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('Failed to resolve application version', {
        error: message,
      });

      throw new InternalServerErrorException(
        'Unable to resolve application version',
      );
    }
  }

  async processComplexOperation(userId: number, action: string) {
    const tracer = trace.getTracer('test-service');

    return tracer.startActiveSpan(
      'service.complex-operation',
      {
        attributes: {
          'user.id': userId,
          'operation.action': action,
        },
      },
      async (span) => {
        try {
          this.logger.log(
            `Starting complex operation for user ${userId} with action: ${action}`,
          );

          // Step 1: Validate user
          const user = await this.validateUser(userId);
          span.addEvent('User validated', { username: user.username });
          this.logger.log(`User validated: ${user.username}`, {
            userId,
            username: user.username,
          });

          // Step 2: Fetch user data
          const userData = await this.fetchUserData(userId);
          span.addEvent('User data fetched', {
            recordsFound: userData.records.length,
          });
          this.logger.log(
            `Fetched ${userData.records.length} records for user ${userId}`,
          );

          // Step 3: Process business logic
          const processed = await this.processBusinessLogic(action, userData);
          span.addEvent('Business logic processed', {
            itemsProcessed: processed.count,
          });
          this.logger.log(`Processed ${processed.count} items`, {
            action,
            metrics: processed.metrics,
          });

          // Step 4: Save results
          await this.saveResults(userId, processed);
          span.addEvent('Results saved');
          this.logger.log(`Results saved successfully for user ${userId}`, {
            userId,
          });

          span.setStatus({ code: SpanStatusCode.OK });

          return {
            userId,
            action,
            itemsProcessed: processed.count,
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          const errorStack = error instanceof Error ? error.stack : undefined;
          this.logger.error(`Error in complex operation: ${errorMessage}`, {
            userId,
            action,
            error: errorStack,
          });
          span.recordException(error as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: errorMessage,
          });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  private async validateUser(userId: number) {
    const tracer = trace.getTracer('test-service');

    return tracer.startActiveSpan(
      'service.validate-user',
      {
        attributes: {
          'user.id': userId,
        },
      },
      async (span) => {
        try {
          // Simulate database call
          await this.simulateDelay(50);

          const user = {
            id: userId,
            username: `user_${userId}`,
            email: `user${userId}@example.com`,
          };

          span.setAttribute('user.username', user.username);
          span.setAttribute('user.email', user.email);
          span.setStatus({ code: SpanStatusCode.OK });

          return user;
        } finally {
          span.end();
        }
      },
    );
  }

  private async fetchUserData(userId: number) {
    const tracer = trace.getTracer('test-service');

    return tracer.startActiveSpan(
      'service.fetch-user-data',
      {
        attributes: {
          'user.id': userId,
          'data.source': 'database',
        },
      },
      async (span) => {
        try {
          // Simulate database query
          await this.simulateDelay(100);

          const records = Array.from({ length: 5 }, (_, i) => ({
            id: i + 1,
            userId,
            value: Math.random() * 100,
          }));

          span.setAttribute('data.recordCount', records.length);
          span.addEvent('Database query completed', {
            recordCount: records.length,
          });
          span.setStatus({ code: SpanStatusCode.OK });

          return { records };
        } finally {
          span.end();
        }
      },
    );
  }

  private async processBusinessLogic(
    action: string,
    userData: { records: any[] },
  ) {
    const tracer = trace.getTracer('test-service');

    return tracer.startActiveSpan(
      'service.process-business-logic',
      {
        attributes: {
          'operation.action': action,
          'data.inputRecords': userData.records.length,
        },
      },
      async (span) => {
        try {
          // Simulate complex processing
          await this.simulateDelay(150);

          // Nested span for calculation
          const calculated = await tracer.startActiveSpan(
            'service.calculate-metrics',
            async (calcSpan) => {
              try {
                await this.simulateDelay(75);

                const sum = userData.records.reduce(
                  (acc, record) => acc + record.value,
                  0,
                );
                const avg = sum / userData.records.length;

                calcSpan.setAttribute('metrics.sum', sum);
                calcSpan.setAttribute('metrics.average', avg);
                calcSpan.setStatus({ code: SpanStatusCode.OK });

                return { sum, avg };
              } finally {
                calcSpan.end();
              }
            },
          );

          span.addEvent('Calculations completed', {
            sum: calculated.sum,
            average: calculated.avg,
          });

          span.setAttribute('processing.status', 'completed');
          span.setStatus({ code: SpanStatusCode.OK });

          return {
            count: userData.records.length,
            action,
            metrics: calculated,
          };
        } finally {
          span.end();
        }
      },
    );
  }

  private async saveResults(userId: number, data: any) {
    const tracer = trace.getTracer('test-service');

    return tracer.startActiveSpan(
      'service.save-results',
      {
        attributes: {
          'user.id': userId,
          'data.itemCount': data.count,
        },
      },
      async (span) => {
        try {
          // Simulate database write
          await this.simulateDelay(80);

          span.addEvent('Data persisted', {
            userId,
            recordCount: data.count,
          });
          span.setStatus({ code: SpanStatusCode.OK });

          return { saved: true };
        } finally {
          span.end();
        }
      },
    );
  }

  private async simulateDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
