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
  HytaleConfig,
  MinecraftConfig,
  SatisfactoryConfig,
} from '../pterodactyl/Environment/GameConfig';
import { Span, trace } from '@opentelemetry/api';
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
        if (e && typeof e === 'object' && 'message' in e) {
          return String((e as Record<string, unknown>).message);
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
  tracer = trace.getTracer('PterodactylService', '1.0.0');

  constructor(
    private readonly orderService: OrderService,
    private readonly ptClient: PterodactylClientService,
    private readonly envService: EnvironmentService,
    private readonly logger: LoggerService,
    private readonly ports: PterodactylPortService,
    private readonly installation: InstallationService,
    private readonly emailService: EmailService,
  ) {}

  async provisionServer(order: GameServerOrder, job: Job): Promise<string> {
    return this.tracer.startActiveSpan('provisioning', async (span: Span) => {
      span.setAttribute('order.id', order.id);
      span.setAttribute('user.id', order.userId);

      const { order: validatedOrder, gameConfig } =
        await this.orderService.getValidatedOrder(order.id);

      span.setAttribute('game.id', validatedOrder.creationGameData?.id || -1);
      span.setAttribute(
        'game.name',
        validatedOrder.creationGameData?.name || 'unknown',
      );
      span.setAttribute('egg.id', gameConfig.eggId);

      const serverOptions = this.buildServerOptions(validatedOrder, gameConfig);

      await job.updateProgress(30);

      const serverId =
        await this.orderService.createGameServerRecord(validatedOrder);

      span.setAttribute('server.dbId', serverId);

      const ptServer = await this.createPterodactylServer(
        serverOptions,
        serverId,
        validatedOrder.id,
        job,
      );
      await job.updateProgress(60);

      span.setAttribute('server.ptId', ptServer.identifier);

      await this.ports.correctPorts(
        ptServer.identifier,
        order.creationGameData.slug,
        order.user,
      );

      await job.updateProgress(70);

      const scriptsEnabled = await this.installation.toggleScripts(
        ptServer.id.toString(),
        false,
      );
      span.setAttribute('install.scriptsEnabled', scriptsEnabled);

      await job.updateProgress(75);

      const reinstallSuccessfull = await this.installation.triggerInstallation(
        ptServer.id.toString(),
      );

      span.setAttribute('install.reinstallSuccessfull', reinstallSuccessfull);
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
          serverUrl: `${process.env.WEB_APP_URL}/server/${ptServer.identifier}`,
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
        `Provisioned server ${ptServer.identifier} (DB ID: ${serverId}) for order ${order.id}`,
      );
      span.end();
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
      .setResources(order.cpuPercent, order.ramMB)
      .setLocation(order.creationLocation.ptLocationId)
      .setEnvironment(environmentConfig)
      .setStartWhenInstalled(false)
      .build();
  }

  private getEnvironmentConfig(
    gameSlug: string,
    gameConfig: GameConfigBase,
  ): EnvironmentConfig {
    switch (gameSlug) {
      case 'minecraft': {
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
    return await this.tracer.startActiveSpan(
      'createServerPT',
      async (span: Span) => {
        try {
          span.setAttribute('server.dbId', serverId);
          span.setAttribute('order.id', orderId);
          span.setAttribute('server.name', options.name);

          this.logger.log('Create Server with: ', { options });

          const ptServer = await this.ptClient.createServerWithRetry(options);

          span.setAttribute('server.ptId', ptServer.identifier);
          span.setAttribute('server.uuid', ptServer.uuid);

          this.logger.log(
            `Provisioned server ${ptServer.identifier} for order ${orderId}`,
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
          if (error instanceof Error) {
            span.recordException(error);
          } else {
            span.recordException(new Error(message));
          }
          this.logger.error(
            `Failed to provision server for order ${orderId}: ${message}`,
            { rawError: JSON.stringify(error) },
          );
          await this.orderService.markServerFailed(serverId);
          throw new Error(`Provisioning failed: ${message}`);
        } finally {
          span.end();
        }
      },
    );
  }
}
