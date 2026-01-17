import { Module } from '@nestjs/common';
import { InstallationModule } from './Installation/installation.module';
import { EnvironmentModule } from './Environment/environment.module';
import { PortsModule } from './Ports/port.module';

@Module({
  providers: [InstallationModule, EnvironmentModule, PortsModule],
  exports: [InstallationModule, EnvironmentModule, PortsModule],
})
export class PterodactylModule {}
