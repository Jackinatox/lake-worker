import { Controller, Get, Post, Param } from '@nestjs/common';
import { JobScheduler } from '../schedulers/job.scheduler';
import { JobRunService } from '../services/job-run.service';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly scheduler: JobScheduler,
    private readonly jobRunService: JobRunService,
  ) {}

  /**
   * Get status of all scheduled jobs
   */
  @Get('status')
  getStatus() {
    return {
      timestamp: new Date().toISOString(),
      jobs: this.scheduler.getStatus(),
    };
  }

  /**
   * Get recent job runs
   */
  @Get('runs')
  async getRecentRuns() {
    const runs = await this.jobRunService.getRecentJobRuns(undefined, 50);
    return {
      timestamp: new Date().toISOString(),
      runs,
    };
  }

  /**
   * Get details of a specific job run
   */
  @Get('runs/:id')
  async getJobRunDetails(@Param('id') id: string) {
    const details = await this.jobRunService.getJobRunDetails(id);
    if (!details) {
      return { error: 'Job run not found' };
    }
    return details;
  }

  /**
   * Manually trigger a job
   */
  @Post('trigger/:jobName')
  async triggerJob(
    @Param('jobName')
    jobName:
      | 'ExpireServers'
      | 'DeleteServers'
      | 'SendEmails'
      | 'GenerateExpiryEmails'
      | 'GenerateDeletionEmails'
      | 'ProcessSuspensions',
  ) {
    const result = await this.scheduler.triggerJob(jobName);
    return {
      timestamp: new Date().toISOString(),
      ...result,
    };
  }
}
