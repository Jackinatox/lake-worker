import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProvisioningController } from './provisioning.controller';
import { ProvisioningProcessor } from './provisioning.processor';
import { QueueProvisionService } from './queuing.service';
import { PterodactylService } from './pterodactyl.service';
import { OrderService } from './services/order.service';
import { PterodactylClientService } from './services/pterodactyl-client.service';
import { ChangeGameService } from './services/change-game.service';
import { CoreModule } from 'src/core/core.module';
import { EnvironmentModule } from '../pterodactyl/Environment/environment.module';
import { PortsModule } from '../pterodactyl/Ports/port.module';
import { InstallationModule } from '../pterodactyl/Installation/installation.module';

@Module({
  imports: [
    CoreModule,
    EnvironmentModule,
    PortsModule,
    InstallationModule,
    BullModule.registerQueue({
      name: 'provisioning',
    }),
  ],
  controllers: [ProvisioningController],
  providers: [
    QueueProvisionService,
    ProvisioningProcessor,
    PterodactylService,
    PterodactylClientService,
    OrderService,
    ChangeGameService,
  ],
  exports: [PterodactylService],
})
export class ProvisioningModule {}
