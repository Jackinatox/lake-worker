import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CreateProvisioningJobDto } from './dto/create-provisioning-job.dto';
import { QueueProvisionService } from './queuing.service';
import { trace } from '@opentelemetry/api';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';

@Controller({
  path: 'queue',
  version: ['1'],
})
export class ProvisioningController {
  constructor(
    private provisioningService: QueueProvisionService,
    @InjectQueue('provisioning') private provisioningQueue: Queue,
  ) {}

  @Post('provision')
  @HttpCode(HttpStatus.ACCEPTED)
  async createJob(@Body() dto: CreateProvisioningJobDto) {
    const tracer = trace.getTracer('provisioning-api');

    return tracer.startActiveSpan(
      'order.enqueue-provisioning',
      {
        attributes: {
          'order.id': dto.orderId,
        },
      },
      async (span) => {
        try {
          return await this.provisioningService.createProvisioningJob(
            dto.orderId,
          );
        } finally {
          span.end();
        }
      },
    );
  }

  @Get('jobstatus/:jobId')
  async getJobStatus(@Param() params: { jobId: string }) {
    const job = await this.provisioningQueue.getJob(params.jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${params.jobId} not found`);
    } else {
      const state = await job.getState();
      return {
        success: true,
        jobId: job.id,
        state,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: job.data,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        progress: job.progress,
      };
    }
  }
}
