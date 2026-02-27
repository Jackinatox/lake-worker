import { Global, Module } from '@nestjs/common';
import { ConfigCacheService } from './config-cache.service';
import { LoggerService } from './logger.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, LoggerService, ConfigCacheService],
  exports: [PrismaService, LoggerService, ConfigCacheService],
})
export class CoreModule {}
