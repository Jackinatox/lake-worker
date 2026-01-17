import { Module } from '@nestjs/common';
import { PterodactylPortService as PortService } from './port.service';

@Module({
  providers: [PortService],
  exports: [PortService],
})
export class PortsModule {}
