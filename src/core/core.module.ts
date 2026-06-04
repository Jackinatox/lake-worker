import { Global, Module } from '@nestjs/common';
import { ConfigCacheService } from './config-cache.service';
import { LoggerService } from './logger.service';
import { PrismaService } from './prisma.service';
import { PterodactylPrismaService } from './pterodactyl-prisma.service';

@Global()
@Module({
  providers: [PrismaService, PterodactylPrismaService, LoggerService, ConfigCacheService],
  exports: [PrismaService, PterodactylPrismaService, LoggerService, ConfigCacheService],
})
export class CoreModule {}
