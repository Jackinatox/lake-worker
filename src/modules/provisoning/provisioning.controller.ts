import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { CreateProvisioningJobDto } from './dto/create-provisioning-job.dto';
import { QueueProvisionService } from './queuing.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { ChangeGameDto } from './dto/ChangeGameDto';
import { ChangeGameService } from './services/change-game.service';
import { LogContextService } from 'src/core/log-context.service';
import { LoggerService } from 'src/core/logger.service';
import { LogType } from 'src/generated/prisma/client';

@Controller({
  path: 'queue',
  version: ['1'],
})
export class ProvisioningController {
  constructor(
    private provisioningService: QueueProvisionService,
    private changeGameService: ChangeGameService,
    private logger: LoggerService,
    private logContext: LogContextService,
    @InjectQueue('provisioning') private provisioningQueue: Queue,
  ) {}

  @Post('provision')
  @HttpCode(HttpStatus.ACCEPTED)
  async createJob(@Body() dto: CreateProvisioningJobDto) {
    return this.logContext.run(
      { component: ProvisioningController.name, type: LogType.GAME_SERVER },
      () => this.provisioningService.createProvisioningJob(dto.orderId),
    );
  }

  @Get('jobstatus/:jobId')
  async getJobStatus(@Param() params: { jobId: string }) {
    const job = await this.provisioningQueue.getJob(params.jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${params.jobId} not found`);
    } else {
      const state = await job.getState();
      return {
        success: true,
        jobId: job.id,
        state,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: job.data,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        progress: job.progress,
      };
    }
  }

  @Post('changeGame')
  @HttpCode(HttpStatus.OK)
  async changeGame(@Body() dto: ChangeGameDto) {
    return this.logContext.run(
      {
        component: ProvisioningController.name,
        type: LogType.GAME_SERVER,
        userId: dto.userId,
      },
      () => {
        this.logger.log('Changing Game', { details: { changeGameData: dto } });
        return this.changeGameService.changeGame({
          ptServerId: dto.ptServerId,
          gameSlug: dto.gameSlug,
          gameConfig: dto.gameConfig,
          deleteFiles: dto.deleteFiles,
          userId: dto.userId,
        });
      },
    );
  }
}
