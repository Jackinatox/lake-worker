import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { JobsModule } from '../jobs/jobs.module';
import { CoreModule } from 'src/core/core.module';

@Module({
  providers: [EmailService],
  exports: [EmailService],
  imports: [JobsModule, CoreModule],
})
export class EmailModule {}
