import { Injectable } from '@nestjs/common';
import { trace, SpanStatusCode } from '@opentelemetry/api';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
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
          // Step 1: Validate user
          const user = await this.validateUser(userId);
          span.addEvent('User validated', { username: user.username });

          // Step 2: Fetch user data
          const userData = await this.fetchUserData(userId);
          span.addEvent('User data fetched', {
            recordsFound: userData.records.length,
          });

          // Step 3: Process business logic
          const processed = await this.processBusinessLogic(action, userData);
          span.addEvent('Business logic processed', {
            itemsProcessed: processed.count,
          });

          // Step 4: Save results
          await this.saveResults(userId, processed);
          span.addEvent('Results saved');

          span.setStatus({ code: SpanStatusCode.OK });

          return {
            userId,
            action,
            itemsProcessed: processed.count,
            timestamp: new Date().toISOString(),
          };
        } catch (error) {
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
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
