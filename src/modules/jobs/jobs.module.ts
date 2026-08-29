import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';

// Services
import { JobRunService } from './services/job-run.service';
import { NotificationService } from './services/notification.service';
import { EmailTransportService } from './services/emailTransport.service';
import { EmailTemplateService } from './services/email-template.service';
import { ExpireServersService } from './services/expire-servers.service';
import { DeleteServersService } from './services/delete-servers.service';
import { SendEmailsService } from './services/send-emails.service';
import { GenerateExpiryEmailsService } from './services/generate-expiry-emails.service';
import { GenerateDeletionEmailsService } from './services/generate-deletion-emails.service';
import { ProcessSuspensionsService } from './services/process-suspensions.service';

// Schedulers
import { JobScheduler } from './schedulers/job.scheduler';

// Controllers
import { JobsController } from './controllers/jobs.controller';

@Module({
  imports: [ScheduleModule.forRoot(), ConfigModule],
  controllers: [JobsController],
  providers: [
    // Core services
    JobRunService,
    NotificationService,
    EmailTransportService,
    EmailTemplateService,

    // Job services
    ExpireServersService,
    DeleteServersService,
    SendEmailsService,
    GenerateExpiryEmailsService,
    GenerateDeletionEmailsService,
    ProcessSuspensionsService,

    // Schedulers
    JobScheduler,
  ],
  exports: [
    JobRunService,
    NotificationService,
    EmailTransportService,
    EmailTemplateService,
  ],
})
export class JobsModule {}
