import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { LoggerService } from './logger.service';

@Global() // Makes PrismaService and LoggerService available everywhere without importing CoreModule
@Module({
  providers: [PrismaService, LoggerService],
  exports: [PrismaService, LoggerService],
})
export class CoreModule {}
