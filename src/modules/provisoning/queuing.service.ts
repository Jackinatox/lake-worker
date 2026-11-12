import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { LoggerService } from '../../core/logger.service';
import { PrismaService } from '../../core/prisma.service';
import { LogType } from 'src/generated/prisma/client';

@Injectable()
export class QueueProvisionService {
  constructor(
    private prisma: PrismaService,
    private readonly logger: LoggerService,
    @InjectQueue('provisioning') private provisioningQueue: Queue,
  ) {}

  async createProvisioningJob(orderId: string) {
    this.logger.log(`Queuing provisioning job for order ID: ${orderId}`, {
      component: QueueProvisionService.name,
      logType: LogType.GAME_SERVER,
      orderId,
    });
    // Fetch the order from the database
    const order = await this.prisma.gameServerOrder.findUnique({
      where: { id: orderId },
      include: {
        creationGameData: true,
        creationLocation: true,
        user: true,
      },
    });
    await this.prisma.gameServerOrder.update({
      where: { id: orderId },
      data: {
        workerJobId: orderId,
      },
    });

    // Validate the order exists
    if (!order) {
      this.logger.warn(`Order with ID ${orderId} not found`, {
        component: QueueProvisionService.name,
        logType: LogType.GAME_SERVER,
        orderId,
      });
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    // Add the job to the queue
    const job = await this.provisioningQueue.add(
      'provision-server',
      { orderId: order.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        jobId: order.id,
      },
    );

    this.logger.log(
      `Queued provisioning job with job ID: ${job.id} for order ID: ${orderId}`,
      {
        component: QueueProvisionService.name,
        logType: LogType.GAME_SERVER,
        userId: order.userId,
        orderId,
        jobId: job.id,
      },
    );

    return {
      success: true,
      message: 'Provisioning job queued',
      jobId: job.id,
      orderId: order.id,
    };
  }
}
