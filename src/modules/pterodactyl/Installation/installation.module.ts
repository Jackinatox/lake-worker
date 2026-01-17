import { Module } from '@nestjs/common';
import { InstallationService } from './installation.service';

@Module({
  providers: [InstallationService],
  exports: [InstallationService],
})
export class InstallationModule {}
