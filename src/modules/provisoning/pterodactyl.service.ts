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
  HytaleGameId,
  MinecraftGameId,
  SatisfactoryGameId,
} from 'src/lib/GlobalConsstants';
import {
  HytaleConfig,
  SatisfactoryConfig,
} from '../pterodactyl/Environment/GameConfig';
import { Span, trace } from '@opentelemetry/api';
import { LoggerService } from 'src/core/logger.service';
import { PterodactylPortService } from '../pterodactyl/Ports/port.service';
import { InstallationService } from '../pterodactyl/Installation/installation.service';
import { Server } from '@avionrx/pterodactyl-js';
import { EmailService } from '../email/email.service';
import { OrderType } from 'src/generated/prisma/client';

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
        order.creationGameDataId,
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
    const gameId = order.creationGameData.id;
    const environmentConfig = this.getEnvironmentConfig(gameId, gameConfig);
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
    gameId: number,
    gameConfig: GameConfigBase,
  ): EnvironmentConfig {
    switch (gameId) {
      case MinecraftGameId:
        return this.envService.minecraft(
          gameConfig.eggId,
          gameConfig.version,
        ) as EnvironmentConfig;
      case SatisfactoryGameId:
        return this.envService.satisfactory(
          gameConfig.gameSpecificConfig as SatisfactoryConfig,
        ) as EnvironmentConfig;
      case HytaleGameId:
        return this.envService.hytale(
          gameConfig.gameSpecificConfig as HytaleConfig,
        ) as EnvironmentConfig;
      default:
        throw new Error(`Unsupported game ID: ${gameId}`);
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
          if (error instanceof Error) {
            span.recordException(error);
          }
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(
            `Failed to provision server for order ${orderId}: ${message}`,
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
