import { Module } from '@nestjs/common';
import { CoreModule } from 'src/core/core.module';
import { WingsController } from './wings.controller';
import { WingsService } from './wings.service';

@Module({
  imports: [CoreModule],
  providers: [WingsService],
  controllers: [WingsController],
})
export class WingsModule {}
