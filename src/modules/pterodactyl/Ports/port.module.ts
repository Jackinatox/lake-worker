import { Module } from '@nestjs/common';
import { PterodactylPortService as PortService } from './port.service';
import { PortsController } from './ports.controller';

@Module({
  providers: [PortService],
  exports: [PortService],
  controllers: [PortsController],
})
export class PortsModule {}
