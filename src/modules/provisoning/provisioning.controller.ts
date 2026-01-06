import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { CreateProvisioningJobDto } from './dto/create-provisioning-job.dto';
import { QueueProvisionService } from './queuing.service';
import { trace } from '@opentelemetry/api';

@Controller('queue')
export class ProvisioningController {
  constructor(private provisioningService: QueueProvisionService) {}

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
}
