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
import { MinecraftGameId, SatisfactoryGameId } from 'src/lib/GlobalConsstants';
import { SatisfactoryConfig } from '../pterodactyl/Environment/GameConfig';
import { Span, trace } from '@opentelemetry/api';
import { LoggerService } from 'src/core/logger.service';
import { PterodactylPortService } from '../pterodactyl/Ports/pterodactylPort.service';

@Injectable()
export class PterodactylService {
  tracer = trace.getTracer('PterodactylService', '1.0.0');

  constructor(
    private readonly orderService: OrderService,
    private readonly ptClient: PterodactylClientService,
    private readonly envService: EnvironmentService,
    private readonly logger: LoggerService,
    private readonly ports: PterodactylPortService,
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

      const ptId = await this.createPterodactylServer(
        serverOptions,
        serverId,
        String(validatedOrder.id),
        job,
      );

      span.setAttribute('server.ptId', ptId);

      await this.ports.correctPorts(
        ptId,
        order.creationGameDataId || 1,
        order.user,
      );

      span.end();
      return serverId;
    });
  }

  private buildServerOptions(
    order: GameServerOrder,
    gameConfig: GameConfigBase,
  ) {
    const gameId = order.creationGameData!.id;
    const environmentConfig = this.getEnvironmentConfig(gameId, gameConfig);
    const serverName = `${order.creationGameData!.name} Gameserver`;

    if (!order.user.ptUserId) {
      throw new Error(`User ${order.userId} has no Pterodactyl user ID`);
    }

    return new ServerOptionsBuilder()
      .setName(serverName)
      .setUser(order.user.ptUserId)
      .setEgg(parseInt(gameConfig.eggId))
      .setDockerImage(gameConfig.dockerImage)
      .setResources(order.cpuPercent, order.ramMB)
      .setLocation(order.creationLocation!.ptLocationId)
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
          parseInt(gameConfig.eggId),
          gameConfig.version as string,
        ) as EnvironmentConfig;
      case SatisfactoryGameId:
        return this.envService.satisfactory(
          gameConfig.gameSpecificConfig as SatisfactoryConfig,
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
  ): Promise<string> {
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
          );

          await job.updateData({
            ...job.data,
            ptServerId: ptServer.identifier,
            ptAdminId: ptServer.id,
          });

          await job.updateProgress(50);
          return ptServer.identifier;
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
