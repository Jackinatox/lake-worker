import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../core/prisma.service';

@Injectable()
export class ProvisioningService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('provisioning') private provisioningQueue: Queue,
  ) {}

  async createProvisioningJob(orderId: number) {
    console.log(`Creating provisioning job for order ID: ${orderId}`);
    // Fetch the order from the database
    const order = await this.prisma.gameServerOrder.findUnique({
      where: { id: orderId },
      include: {
        creationGameData: true,
        creationLocation: true,
        user: true,
      },
    });

    // Validate the order exists
    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    // Validate the order status is PAID
    if (order.status !== 'PAID') {
      throw new BadRequestException(
        `Order must be in PAID status. Current status: ${order.status}`,
      );
    }

    // Add the job to the queue
    const job = await this.provisioningQueue.add(
      'provision-server',
      { orderId: order.id },
      {
        jobId: `provision-order-${order.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return {
      success: true,
      message: 'Provisioning job created',
      jobId: job.id,
      orderId: order.id,
    };
  }
}
