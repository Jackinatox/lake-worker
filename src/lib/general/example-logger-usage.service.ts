import { Injectable } from '@nestjs/common';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { LoggerService } from 'src/core/logger.service';

/**
 * Example service showing how to use the logger with tracing
 * This demonstrates best practices for logging in your NestJS application
 */
@Injectable()
export class ExampleService {
  constructor(private readonly logger: LoggerService) {}

  /**
   * Simple method with basic logging
   */
  async simpleMethod(id: number) {
    this.logger.log(`Processing item ${id}`);

    // Do some work
    const result = await this.doWork(id);

    this.logger.log(`Successfully processed item ${id}`, { result });
    return result;
  }

  /**
   * Method with error handling and logging
   */
  async methodWithErrorHandling(userId: number) {
    try {
      this.logger.log(`Starting operation for user ${userId}`);

      const data = await this.fetchData(userId);

      if (!data) {
        this.logger.warn(`No data found for user ${userId}`);
        return null;
      }

      this.logger.log(`Data retrieved successfully`, {
        userId,
        recordCount: data.length,
      });

      return data;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch data for user ${userId}`, {
        userId,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Method with manual tracing and detailed logging
   * Logs will automatically include trace_id and span_id
   */
  async complexMethodWithTracing(orderId: string, userId: number) {
    const tracer = trace.getTracer('example-service');

    return tracer.startActiveSpan(
      'example.complex-method',
      {
        attributes: {
          'order.id': orderId,
          'user.id': userId,
        },
      },
      async (span) => {
        try {
          this.logger.log(`Processing order ${orderId} for user ${userId}`);

          // Step 1: Validate
          this.logger.debug('Validating order', { orderId });
          const valid = await this.validateOrder(orderId);

          if (!valid) {
            this.logger.warn(`Invalid order ${orderId}`);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: 'Invalid order',
            });
            throw new Error('Invalid order');
          }

          // Step 2: Process
          this.logger.log('Order validated, processing payment');
          const payment = await this.processPayment(orderId, userId);
          this.logger.log('Payment processed successfully', {
            orderId,
            transactionId: payment.transactionId,
            amount: payment.amount,
          });

          // Step 3: Ship
          this.logger.log('Initiating shipment');
          const shipment = await this.createShipment(orderId);
          this.logger.log('Shipment created', {
            orderId,
            trackingNumber: shipment.trackingNumber,
          });

          span.setStatus({ code: SpanStatusCode.OK });
          this.logger.log(`Order ${orderId} completed successfully`);

          return {
            orderId,
            transactionId: payment.transactionId,
            trackingNumber: shipment.trackingNumber,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(`Order processing failed: ${errorMessage}`, {
            orderId,
            userId,
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

  /**
   * Using structured logging with custom context
   */
  async structuredLogging(data: {
    action: string;
    metadata: Record<string, unknown>;
  }) {
    this.logger.logWithContext('info', 'Custom action performed', {
      action: data.action,
      metadata: data.metadata,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Logging at different levels
   */
  async demonstrateLogLevels() {
    // Debug - detailed information for debugging
    this.logger.debug('Detailed debug information', {
      internalState: 'some-value',
    });

    // Info - general information about application flow
    this.logger.log('Normal operation', {
      status: 'running',
    });

    // Warn - warning messages for potentially harmful situations
    this.logger.warn('Something unusual happened', {
      issue: 'rate-limit-approaching',
    });

    // Error - error events that might still allow the app to continue
    this.logger.error('An error occurred', {
      errorCode: 'ERR_001',
    });

    // Verbose - more detailed than debug
    this.logger.verbose('Very detailed trace information', {
      allTheDetails: true,
    });
  }

  /**
   * Logging in loops or bulk operations
   */
  async processBatch(items: number[]) {
    this.logger.log(`Starting batch processing of ${items.length} items`);

    let successCount = 0;
    let errorCount = 0;

    for (const item of items) {
      try {
        await this.processItem(item);
        successCount++;

        // Log every 10 items to avoid log spam
        if (successCount % 10 === 0) {
          this.logger.log(
            `Progress: ${successCount}/${items.length} items processed`,
          );
        }
      } catch (error) {
        errorCount++;
        this.logger.error(`Failed to process item ${item}`, {
          item,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log(`Batch processing complete`, {
      total: items.length,
      successful: successCount,
      failed: errorCount,
    });

    return { successCount, errorCount };
  }

  // Helper methods (mock implementations)
  private async doWork(id: number): Promise<string> {
    return `result-${id}`;
  }

  private async fetchData(userId: number): Promise<string[] | null> {
    return [`data-${userId}`];
  }

  private async validateOrder(orderId: string): Promise<boolean> {
    return true;
  }

  private async processPayment(
    orderId: string,
    userId: number,
  ): Promise<{ transactionId: string; amount: number }> {
    return {
      transactionId: `txn-${orderId}`,
      amount: 99.99,
    };
  }

  private async createShipment(
    orderId: string,
  ): Promise<{ trackingNumber: string }> {
    return {
      trackingNumber: `TRACK-${orderId}`,
    };
  }

  private async processItem(item: number): Promise<void> {
    // Mock processing
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
