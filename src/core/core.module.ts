import { Global, Module } from '@nestjs/common';
import { ConfigCacheService } from './config-cache.service';
import { LogContextService } from './log-context.service';
import { LoggerService } from './logger.service';
import { PrismaService } from './prisma.service';
import { PterodactylPrismaService } from './pterodactyl-prisma.service';

@Global()
@Module({
  providers: [
    PrismaService,
    PterodactylPrismaService,
    LogContextService,
    LoggerService,
    ConfigCacheService,
  ],
  exports: [
    PrismaService,
    PterodactylPrismaService,
    LogContextService,
    LoggerService,
    ConfigCacheService,
  ],
})
export class CoreModule {}
