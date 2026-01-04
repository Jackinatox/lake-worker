import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CreateProvisioningJobDto } from './dto/create-provisioning-job.dto';
import { ProvisioningService } from './queuing.service';

@Controller('provisioning')
export class ProvisioningController {
  constructor(private provisioningService: ProvisioningService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async createJob(@Body() dto: CreateProvisioningJobDto) {
    return this.provisioningService.createProvisioningJob(dto.orderId);
  }
}
