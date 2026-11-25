import { Global, Module } from '@nestjs/common';
import { ConfigCacheService } from './config-cache.service';
import { LogContextService } from './log-context.service';
import { LoggerService } from './logger.service';
import { PrismaService } from './prisma.service';
import { PterodactylPrismaService } from './pterodactyl-prisma.service';
import { TelegramAlertService } from './telegram-alert.service';
import { TelegramClient } from './telegram.client';

@Global()
@Module({
  providers: [
    PrismaService,
    PterodactylPrismaService,
    LogContextService,
    TelegramClient,
    TelegramAlertService,
    LoggerService,
    ConfigCacheService,
  ],
  exports: [
    PrismaService,
    PterodactylPrismaService,
    LogContextService,
    TelegramClient,
    TelegramAlertService,
    LoggerService,
    ConfigCacheService,
  ],
})
export class CoreModule {}
