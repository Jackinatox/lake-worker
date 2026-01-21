import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';

// Services
import { JobRunService } from './services/job-run.service';
import { NotificationService } from './services/notification.service';
import { EmailService } from './services/email.service';
import { EmailTemplateService } from './services/email-template.service';
import { ExpireServersService } from './services/expire-servers.service';
import { DeleteServersService } from './services/delete-servers.service';
import { SendEmailsService } from './services/send-emails.service';
import { GenerateExpiryEmailsService } from './services/generate-expiry-emails.service';
import { GenerateDeletionEmailsService } from './services/generate-deletion-emails.service';

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
    EmailService,
    EmailTemplateService,

    // Job services
    ExpireServersService,
    DeleteServersService,
    SendEmailsService,
    GenerateExpiryEmailsService,
    GenerateDeletionEmailsService,

    // Schedulers
    JobScheduler,
  ],
  exports: [
    JobRunService,
    NotificationService,
    EmailService,
    EmailTemplateService,
  ],
})
export class JobsModule {}
