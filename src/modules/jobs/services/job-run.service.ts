import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/core/prisma.service';
import { LoggerService } from 'src/core/logger.service';
import {
  WorkerJobType,
  JobRunStatus,
  LogLevel,
} from 'src/generated/prisma/client';

export interface JobContext {
  jobRunId: string;
  jobType: WorkerJobType;
}

@Injectable()
export class JobRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Start a new job run and return the context
   */
  async startJobRun(
    jobType: WorkerJobType,
    metadata?: Record<string, unknown>,
  ): Promise<JobContext> {
    const jobRun = await this.prisma.jobRun.create({
      data: {
        jobType,
        status: JobRunStatus.RUNNING,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      },
    });

    this.logger.log(`Job ${jobType} started`, { jobRunId: jobRun.id });

    return {
      jobRunId: jobRun.id,
      jobType,
    };
  }

  /**
   * Mark job as completed successfully
   */
  async completeJobRun(
    jobRunId: string,
    results: { processed: number; total: number; failed?: number },
  ): Promise<void> {
    await this.prisma.jobRun.update({
      where: { id: jobRunId },
      data: {
        status: JobRunStatus.COMPLETED,
        endedAt: new Date(),
        itemsProcessed: results.processed,
        itemsTotal: results.total,
        itemsFailed: results.failed ?? 0,
      },
    });

    this.logger.log('Job completed', {
      jobRunId,
      processed: results.processed,
      total: results.total,
      failed: results.failed,
    });
  }

  /**
   * Mark job as failed with error details
   */
  async failJobRun(
    jobRunId: string,
    error: Error,
    partialResults?: { processed: number; total: number; failed?: number },
  ): Promise<void> {
    await this.prisma.jobRun.update({
      where: { id: jobRunId },
      data: {
        status: JobRunStatus.FAILED,
        endedAt: new Date(),
        errorMessage: error.message,
        errorStack: error.stack,
        itemsProcessed: partialResults?.processed ?? 0,
        itemsTotal: partialResults?.total ?? 0,
        itemsFailed: partialResults?.failed ?? 0,
      },
    });

    this.logger.error(`Job failed`, {
      jobRunId,
      error: error.message,
      stack: error.stack,
    });
  }

  /**
   * Update progress during job execution
   */
  async updateProgress(
    jobRunId: string,
    processed: number,
    total: number,
    failed?: number,
  ): Promise<void> {
    await this.prisma.jobRun.update({
      where: { id: jobRunId },
      data: {
        itemsProcessed: processed,
        itemsTotal: total,
        itemsFailed: failed ?? 0,
      },
    });
  }

  // TODO: Use the global logging util
  /**
   * Log to database with job context
   */
  async log(
    context: JobContext,
    level: LogLevel,
    message: string,
    details?: Record<string, unknown>,
    entityContext?: { gameServerId?: string; userId?: string },
  ): Promise<void> {
    try {
      await this.prisma.workerLog.create({
        data: {
          jobType: context.jobType,
          jobRun: context.jobRunId,
          jobRunId: context.jobRunId,
          level,
          message,
          details: details ? JSON.parse(JSON.stringify(details)) : null,
          gameServerId: entityContext?.gameServerId ?? null,
          userId: entityContext?.userId ?? null,
        },
      });

      // Also log to console/Loki
      const logMethod =
        level === LogLevel.ERROR || level === LogLevel.FATAL
          ? 'error'
          : level === LogLevel.WARN
            ? 'warn'
            : 'log';

      this.logger[logMethod](`[${context.jobType}] ${message}`, {
        jobRunId: context.jobRunId,
        ...details,
        ...entityContext,
      });
    } catch (dbError) {
      // Fallback to console if database logging fails
      this.logger.error('Failed to log to database', {
        error: dbError instanceof Error ? dbError.message : String(dbError),
        originalMessage: message,
      });
    }
  }

  // Convenience methods
  async logInfo(
    context: JobContext,
    message: string,
    details?: Record<string, unknown>,
    entityContext?: { gameServerId?: string; userId?: string },
  ): Promise<void> {
    return this.log(context, LogLevel.INFO, message, details, entityContext);
  }

  async logWarn(
    context: JobContext,
    message: string,
    details?: Record<string, unknown>,
    entityContext?: { gameServerId?: string; userId?: string },
  ): Promise<void> {
    return this.log(context, LogLevel.WARN, message, details, entityContext);
  }

  async logError(
    context: JobContext,
    message: string,
    details?: Record<string, unknown>,
    entityContext?: { gameServerId?: string; userId?: string },
  ): Promise<void> {
    return this.log(context, LogLevel.ERROR, message, details, entityContext);
  }

  async logFatal(
    context: JobContext,
    message: string,
    details?: Record<string, unknown>,
    entityContext?: { gameServerId?: string; userId?: string },
  ): Promise<void> {
    return this.log(context, LogLevel.FATAL, message, details, entityContext);
  }

  /**
   * Get recent job runs for monitoring
   */
  async getRecentJobRuns(
    jobType?: WorkerJobType,
    limit: number = 50,
  ): Promise<
    Array<{
      id: string;
      jobType: WorkerJobType;
      status: JobRunStatus;
      startedAt: Date;
      endedAt: Date | null;
      itemsProcessed: number;
      itemsTotal: number;
      itemsFailed: number;
      errorMessage: string | null;
    }>
  > {
    return this.prisma.jobRun.findMany({
      where: jobType ? { jobType } : undefined,
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        jobType: true,
        status: true,
        startedAt: true,
        endedAt: true,
        itemsProcessed: true,
        itemsTotal: true,
        itemsFailed: true,
        errorMessage: true,
      },
    });
  }

  /**
   * Get job run details with logs
   */
  async getJobRunDetails(jobRunId: string) {
    return this.prisma.jobRun.findUnique({
      where: { id: jobRunId },
      include: {
        logs: {
          orderBy: { createdAt: 'asc' },
          include: {
            gameServer: {
              select: { id: true, name: true, status: true },
            },
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });
  }
}
