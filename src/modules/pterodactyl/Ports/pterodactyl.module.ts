import { Module } from '@nestjs/common';
import { PterodactylPortService as PortService } from './pterodactylPort.service';

@Module({
  providers: [PortService],
  exports: [PortService],
})
export class PortsModule {}
