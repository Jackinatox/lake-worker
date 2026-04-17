import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../core/prisma.service';

@Injectable()
export class QueueProvisionService {
  private readonly logger = new Logger(QueueProvisionService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('provisioning') private provisioningQueue: Queue,
  ) {}

  async createProvisioningJob(orderId: string, traceparent?: string) {
    this.logger.log(`Queuing provisioning job for order ID: ${orderId}`);
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
      this.logger.warn(`Order with ID ${orderId} not found`);
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    // Add the job to the queue
    const job = await this.provisioningQueue.add(
      'provision-server',
      { orderId: order.id, traceparent },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        jobId: order.id,
      },
    );

    this.logger.log(
      `Queued provisioning job with job ID: ${job.id} for order ID: ${orderId}`,
    );

    return {
      success: true,
      message: 'Provisioning job queued',
      jobId: job.id,
      orderId: order.id,
    };
  }
}
