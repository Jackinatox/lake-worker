import { Module } from '@nestjs/common';
import { InstallationModule } from './Installation/installation.module';
import { EnvironmentModule } from './Environment/environment.module';
import { PortsModule } from './Ports/pterodactyl.module';

@Module({
  providers: [InstallationModule, EnvironmentModule, PortsModule],
})
export class PterodactylModule {}
