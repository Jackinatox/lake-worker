import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { LogContextService } from 'src/core/log-context.service';
import { LoggerService } from 'src/core/logger.service';
import { PrismaService } from 'src/core/prisma.service';
import { LogType } from 'src/generated/prisma/client';
import { PterodactylService } from './pterodactyl.service';

interface ProvisioningJobData {
  orderId: string;
}

@Processor('provisioning')
export class ProvisioningProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private pterodactyl: PterodactylService,
    private readonly logger: LoggerService,
    private readonly logContext: LogContextService,
  ) {
    super();
  }

  async process(job: Job<ProvisioningJobData>): Promise<void> {
    const { orderId } = job.data;

    // Everything logged below this scope — however deep in the call stack —
    // is attributed to this order's user, and once the game server record
    // exists, provisionServer narrows the scope to include its id too.
    return this.logContext.run(
      {
        component: ProvisioningProcessor.name,
        type: LogType.GAME_SERVER,
      },
      async () => {
        try {
          this.logger.log(`Processing job ${job.id} for order ${orderId}`, {
            orderId,
            jobId: job.id,
          });

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

          return await this.logContext.run(
            { userId: order.userId },
            async () => {
              this.logger.debug('Order resolved, starting provisioning', {
                orderId,
                gameId: order.creationGameData.id,
                gameName: order.creationGameData.name,
              });

              await job.updateProgress(10);
              await this.pterodactyl.provisionServer(order, job);
              await job.updateProgress(100);
            },
          );
        } catch (error) {
          this.logger.error(`Failed to provision server for order ${orderId}`, {
            orderId,
            jobId: job.id,
            error,
          });
          throw error;
        }
      },
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ProvisioningJobData>) {
    this.logger.log(`Job ${job.id} completed for order ${job.data.orderId}`, {
      component: ProvisioningProcessor.name,
      logType: LogType.GAME_SERVER,
      orderId: job.data.orderId,
      jobId: job.id,
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ProvisioningJobData>, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`, {
      component: ProvisioningProcessor.name,
      logType: LogType.GAME_SERVER,
      orderId: job.data.orderId,
      jobId: job.id,
      error,
    });
  }
}
