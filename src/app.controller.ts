import { Controller, Get, Post, Body } from '@nestjs/common';
import { AppService } from './app.service';
import { trace } from '@opentelemetry/api';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('version')
  getVersion() {
    return { version: this.appService.getVersion() };
  }

  @Post('test-tracing')
  async testTracing(@Body() body: { userId?: number; action?: string }) {
    const tracer = trace.getTracer('test-api');

    return tracer.startActiveSpan(
      'test.process-request',
      {
        attributes: {
          'user.id': body.userId || 1,
          'action.type': body.action || 'test',
          environment: 'development',
        },
      },
      async (span) => {
        try {
          span.addEvent('Request received', {
            timestamp: Date.now(),
            userId: body.userId || 1,
          });

          // Simulate multiple operations with nested spans
          const result = await this.appService.processComplexOperation(
            body.userId || 1,
            body.action || 'test',
          );

          span.addEvent('Request processed successfully');
          span.setAttribute('result.status', 'success');
          span.setAttribute('result.itemsProcessed', result.itemsProcessed);

          return {
            success: true,
            message: 'Tracing test completed',
            data: result,
            traceId: span.spanContext().traceId,
          };
        } catch (error) {
          span.recordException(error);
          span.setAttribute('result.status', 'error');
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }
}
