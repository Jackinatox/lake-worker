import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProvisioningController } from './provisioning.controller';
import { ProvisioningService } from './queuing.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'provisioning',
    }),
  ],
  controllers: [ProvisioningController],
  providers: [ProvisioningService],
})
export class ProvisioningModule {}
