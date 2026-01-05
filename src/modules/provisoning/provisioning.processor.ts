import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from 'src/core/prisma.service';
import { PterodactylService } from './pterodactyl.service';

interface ProvisioningJobData {
  orderId: number;
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
    this.logger.log(`Processing job ${job.id} for order ${job.data.orderId}`);

    const { orderId } = job.data;

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

    try {
      await job.updateProgress(10);

      await this.pterodactyl.provisionServer(order);

      await job.updateProgress(50);

      // Create GameServer record in database

      await job.updateProgress(80);

      // Link the server to the order
      // await this.prisma.gameServerOrder.update({
      //   where: { id: orderId },
      //   data: { gameServerId: gameServer.id },
      // });

      await job.updateProgress(100);

      // this.logger.log(
      //   `Successfully provisioned server ${serverId} for order ${orderId}`,
      // );
    } catch (error) {
      this.logger.error(
        `Failed to provision server for order ${orderId}`,
        error,
      );
      throw error;
    }
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
