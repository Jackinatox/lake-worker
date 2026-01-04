import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ProvisioningService } from './provisioning.service';
import { CreateProvisioningJobDto } from './dto/create-provisioning-job.dto';

@Controller('provisioning')
export class ProvisioningController {
  constructor(private provisioningService: ProvisioningService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async createJob(@Body() dto: CreateProvisioningJobDto) {
    return this.provisioningService.createProvisioningJob(dto.orderId);
  }
}
