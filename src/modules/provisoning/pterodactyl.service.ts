import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  EnvironmentConfig,
  ServerOptionsBuilder,
} from './builders/server-options.builder';
import {
  OrderService,
  GameServerOrder,
  GameConfigBase,
} from './services/order.service';
import { PterodactylClientService } from './services/pterodactyl-client.service';
import { EnvironmentService } from '../pterodactyl/Environment/environment.service';
import {
  FactorioConfig,
  HytaleConfig,
  MinecraftConfig,
  SatisfactoryConfig,
  ValheimConfig,
} from '../pterodactyl/Environment/GameConfig';
import { LogContextService } from 'src/core/log-context.service';
import { LoggerService } from 'src/core/logger.service';
import { PterodactylPortService } from '../pterodactyl/Ports/port.service';
import { InstallationService } from '../pterodactyl/Installation/installation.service';
import { Server } from '@avionrx/pterodactyl-js';
import { EmailService } from '../email/email.service';
import { OrderType } from 'src/generated/prisma/client';

/**
 * Extracts a human-readable message from any thrown value.
 * Handles standard Errors, plain objects (e.g. from @avionrx/pterodactyl-js
 * which rejects with { statusCode, message } instead of Error instances),
 * arrays of error objects, and primitive values.
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (Array.isArray(error)) {
    return error
      .map((e) => {
        if (e && typeof e === 'object') {
          const obj = e as Record<string, unknown>;
          if (typeof obj.detail === 'string') return obj.detail;
          if (typeof obj.message === 'string') return obj.message;
          try {
            return JSON.stringify(e);
          } catch {
            return '[unserializable error]';
          }
        }
        return String(e);
      })
      .join('; ');
  }
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    try {
      return JSON.stringify(error);
    } catch {
      return '[unserializable error]';
    }
  }
  if (typeof error === 'string') return error;
  return String(error);
}

@Injectable()
export class PterodactylService {
  constructor(
    private readonly orderService: OrderService,
    private readonly ptClient: PterodactylClientService,
    private readonly envService: EnvironmentService,
    private readonly logger: LoggerService,
    private readonly logContext: LogContextService,
    private readonly ports: PterodactylPortService,
    private readonly installation: InstallationService,
    private readonly emailService: EmailService,
  ) {}

  async provisionServer(order: GameServerOrder, job: Job): Promise<string> {
    const { order: validatedOrder, gameConfig } =
      await this.orderService.getValidatedOrder(order.id);

    this.logger.debug('Order validated, building server options', {
      orderId: order.id,
      gameId: validatedOrder.creationGameData?.id || -1,
      gameName: validatedOrder.creationGameData?.name || 'unknown',
      eggId: gameConfig.eggId,
    });

    const serverOptions = this.buildServerOptions(validatedOrder, gameConfig);

    await job.updateProgress(30);

    // A retried job must not create a second DB record / PT server
    const existing = await this.orderService.findExistingServer(validatedOrder);

    // Resolved before the log scope opens so that everything below — including
    // the Pterodactyl server creation itself — is attributed to this record.
    const resumeFrom =
      existing?.ptServerId && existing.ptAdminId
        ? { ptServerId: existing.ptServerId, ptAdminId: existing.ptAdminId }
        : null;

    const serverId = existing
      ? existing.serverId
      : await this.orderService.createGameServerRecord(validatedOrder);

    return this.logContext.run({ gameServerId: serverId }, async () => {
      let ptIdentifier: string;
      let ptAdminId: number;

      if (resumeFrom) {
        this.logger.log(
          `Order ${order.id} already has PT server ${resumeFrom.ptServerId}, resuming provisioning`,
          { orderId: order.id, resumed: true },
        );
        ptIdentifier = resumeFrom.ptServerId;
        ptAdminId = resumeFrom.ptAdminId;
      } else {
        if (existing) {
          await this.orderService.resetServerForRetry(serverId);
        }

        const ptServer = await this.createPterodactylServer(
          serverOptions,
          serverId,
          validatedOrder.id,
          job,
        );
        ptIdentifier = ptServer.identifier;
        ptAdminId = ptServer.id;
      }
      await job.updateProgress(60);

      await this.ports.correctPorts(
        ptIdentifier,
        order.creationGameData.slug,
        order.user,
      );

      await job.updateProgress(70);

      const scriptsEnabled = await this.installation.toggleScripts(
        ptAdminId.toString(),
        false,
      );

      await job.updateProgress(75);

      const reinstallSuccessfull = await this.installation.triggerInstallation(
        ptAdminId.toString(),
      );

      this.logger.debug('Installation triggered', {
        ptServerId: ptIdentifier,
        scriptsEnabled,
        reinstallSuccessfull,
      });
      await job.updateProgress(90);

      const gameName = validatedOrder.creationGameData.name;
      const isFreeServer = validatedOrder.type === OrderType.FREE_SERVER;
      await this.emailService.sendServerBookingConfirmationEmail(
        order.user.email,
        {
          userName: order.user.name,
          gameName: gameName,
          gameImageUrl: `${process.env.WEB_APP_URL}/images/light/games/icons/${gameName.toLowerCase()}.webp`,
          serverName: serverOptions.name,
          serverUrl: `${process.env.WEB_APP_URL}/gameserver/${ptIdentifier}`,
          extensionUrl: `${process.env.WEB_APP_URL}/gameserver/${ptIdentifier}/upgrade`,
          cpuVCores: validatedOrder.cpuPercent / 100,
          ramMB: validatedOrder.ramMB,
          diskMB: validatedOrder.diskMB,
          expiresAt: validatedOrder.expiresAt,
          price: validatedOrder.price,
          location:
            validatedOrder.creationLocation?.name || 'Unbekannter Standort',
          isFreeServer: isFreeServer,
        },
      );

      this.logger.log(
        `Provisioned server ${ptIdentifier} (DB ID: ${serverId}) for order ${order.id}`,
        { orderId: order.id, ptServerId: ptIdentifier },
      );
      return serverId;
    });
  }

  private buildServerOptions(
    order: GameServerOrder,
    gameConfig: GameConfigBase,
  ) {
    const gameSlug = order.creationGameData.slug;
    const environmentConfig = this.getEnvironmentConfig(gameSlug, gameConfig);
    const serverName = `${order.creationGameData.name} Gameserver`;

    if (!order.user.ptUserId) {
      throw new Error(`User ${order.userId} has no Pterodactyl user ID`);
    }

    return new ServerOptionsBuilder()
      .setName(serverName)
      .setUser(order.user.ptUserId)
      .setEgg(gameConfig.eggId)
      .setDockerImage(gameConfig.dockerImage)
      .setResources(
        order.cpuPercent,
        order.ramMB,
        order.diskMB,
        order.backupCount,
      )
      .setLocation(order.creationLocation.ptLocationId)
      .setEnvironment(environmentConfig)
      .setStartWhenInstalled(false)
      .setOomKillerDisabled(gameConfig.disableOomKiller ?? false)
      .build();
  }

  private getEnvironmentConfig(
    gameSlug: string,
    gameConfig: GameConfigBase,
  ): EnvironmentConfig {
    switch (gameSlug) {
      case 'minecraft': {
        // Modpack path: lake already resolved eggId/dockerImage to the Modrinth
        // installer egg; we only set its PROJECT_ID/VERSION_ID + own startup.
        if (gameConfig.modpack) {
          return this.envService.modrinth(
            gameConfig.modpack,
          ) as EnvironmentConfig;
        }
        const mcConfig = gameConfig.gameSpecificConfig as MinecraftConfig;
        return this.envService.minecraft(
          mcConfig.flavor,
          gameConfig.version,
        ) as EnvironmentConfig;
      }
      case 'satisfactory':
        return this.envService.satisfactory(
          gameConfig.gameSpecificConfig as SatisfactoryConfig,
        ) as EnvironmentConfig;
      case 'hytale':
        return this.envService.hytale(
          gameConfig.gameSpecificConfig as HytaleConfig,
        ) as EnvironmentConfig;
      case 'factorio':
        return this.envService.factorio(
          gameConfig.gameSpecificConfig as FactorioConfig,
        ) as EnvironmentConfig;
      case 'valheim':
        return this.envService.valheim(
          gameConfig.gameSpecificConfig as ValheimConfig,
        ) as EnvironmentConfig;
      default:
        throw new Error(`Unsupported game slug: ${gameSlug}`);
    }
  }

  /**
   * Will create the server over the Pterodactyl API
   * @param options ka
   * @param serverId from DB
   * @param orderId from DB - for tracing - TODO: will be removed
   * @param job job to tack process for user
   * @returns pteServerId the user can use it to access the server in lake
   */
  private async createPterodactylServer(
    options: ReturnType<ServerOptionsBuilder['build']>,
    serverId: string,
    orderId: string,
    job: Job,
  ): Promise<Server> {
    try {
      this.logger.debug('Creating Pterodactyl server', {
        orderId,
        serverName: options.name,
        options,
      });

      const ptServer = await this.ptClient.createServerWithRetry(options);

      this.logger.log(
        `Provisioned server ${ptServer.identifier} for order ${orderId}`,
        {
          orderId,
          ptServerId: ptServer.identifier,
          ptServerUuid: ptServer.uuid,
        },
      );
      await this.orderService.markServerActive(
        serverId,
        ptServer.identifier,
        ptServer.id,
        orderId,
      );

      await job.updateData({
        ...job.data,
        ptServerId: ptServer.identifier,
        ptAdminId: ptServer.id,
      });

      await job.updateProgress(50);
      return ptServer;
    } catch (error) {
      const message = extractErrorMessage(error);
      this.logger.error(
        `Failed to provision server for order ${orderId}: ${message}`,
        { orderId, error, rawError: JSON.stringify(error) },
      );
      await this.orderService.markServerFailed(serverId);
      throw new Error(`Provisioning failed: ${message}`);
    }
  }
}
