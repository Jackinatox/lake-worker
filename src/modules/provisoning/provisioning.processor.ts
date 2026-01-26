import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  context,
  trace,
  propagation,
  SpanStatusCode,
} from '@opentelemetry/api';
import { PrismaService } from 'src/core/prisma.service';
import { PterodactylService } from './pterodactyl.service';

interface ProvisioningJobData {
  orderId: number;
  traceparent?: string;
}

@Processor('provisioning')
export class ProvisioningProcessor extends WorkerHost {
  private readonly logger = new Logger(ProvisioningProcessor.name);

  constructor(
    private prisma: PrismaService,
    private pterodactyl: PterodactylService,
  ) {
    super();
  }

  async process(job: Job<ProvisioningJobData>): Promise<void> {
    const { orderId, traceparent } = job.data;

    // Rehydrate trace context from traceparent
    let activeContext = context.active();
    if (traceparent) {
      const carrier = { traceparent };
      activeContext = propagation.extract(context.active(), carrier);
    }

    // Run the work within the rehydrated trace context
    return context.with(activeContext, async () => {
      const tracer = trace.getTracer('provisioning-worker');

      return tracer.startActiveSpan('provision-server-worker', async (span) => {
        try {
          span.setAttribute('order.id', orderId);
          span.setAttribute('job.id', job.id || 'unknown');

          this.logger.log(`Processing job ${job.id} for order ${orderId}`);

          // Fetch full order with relations
          const order = await this.prisma.gameServerOrder.findUnique({
            where: { id: orderId },
            include: {
              creationGameData: true,
              creationLocation: true,
              user: true,
            },
          });

          if (!order) {
            throw new Error(`Order ${orderId} not found`);
          }

          span.setAttribute('user.id', order.userId);
          span.setAttribute('game.id', order.creationGameData?.id || -1);
          span.setAttribute(
            'game.name',
            order.creationGameData?.name || 'unknown',
          );

          await job.updateProgress(10);

          await this.pterodactyl.provisionServer(order, job);

          await job.updateProgress(99);

          // this.logger.log(
          //   `Successfully provisioned server ${serverId} for order ${orderId}`,
          // );
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          this.logger.error(
            `Failed to provision server for order ${orderId}`,
            error,
          );
          if (error instanceof Error) {
            span.recordException(error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          }
          throw error;
        } finally {
          span.end();
        }
      });
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ProvisioningJobData>) {
    this.logger.log(`Job ${job.id} completed for order ${job.data.orderId}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ProvisioningJobData>, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }
}
