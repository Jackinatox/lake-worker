import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProvisioningController } from './provisioning.controller';
import { ProvisioningService } from './queuing.service';
import { PterodactylService } from './pterodactyl.service';
import { OrderService } from './services/order.service';
import { PterodactylClientService } from './services/pterodactyl-client.service';
import { EnvironmentModule } from '../pterodactyl/Environment/environment.module';
import { CoreModule } from 'src/core/core.module';

@Module({
  imports: [
    CoreModule,
    EnvironmentModule,
    BullModule.registerQueue({
      name: 'provisioning',
    }),
  ],
  controllers: [ProvisioningController],
  providers: [
    ProvisioningService,
    PterodactylService,
    PterodactylClientService,
    OrderService,
  ],
  exports: [PterodactylService],
})
export class ProvisioningModule {}
