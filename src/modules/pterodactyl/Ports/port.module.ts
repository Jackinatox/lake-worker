import { Module } from '@nestjs/common';
import { CoreModule } from 'src/core/core.module';
import { PterodactylPortService as PortService } from './port.service';
import { PortsController } from './ports.controller';

@Module({
  imports: [CoreModule],
  providers: [PortService],
  exports: [PortService],
  controllers: [PortsController],
})
export class PortsModule {}
