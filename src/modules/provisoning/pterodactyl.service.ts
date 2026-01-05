import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class PterodactylService {
  private readonly logger = new Logger(PterodactylService.name);

  constructor(
    private readonly orderService: OrderService,
    private readonly ptClient: PterodactylClientService,
    private readonly envService: EnvironmentService,
  ) {}

  async provisionServer(order: GameServerOrder, job?: Job): Promise<string> {
    const { order: validatedOrder, gameConfig } =
      await this.orderService.getValidatedOrder(order.id);

    const serverOptions = this.buildServerOptions(validatedOrder, gameConfig);
    await job?.updateProgress(30);

    const serverId =
      await this.orderService.createGameServerRecord(validatedOrder);

    await this.createPterodactylServer(
      serverOptions,
      serverId,
      String(validatedOrder.id),
      job,
    );

    return serverId;
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

  private async createPterodactylServer(
    options: ReturnType<ServerOptionsBuilder['build']>,
    serverId: string,
    orderId: string,
    job?: Job,
  ): Promise<void> {
    try {
      const ptServer = await this.ptClient.createServerWithRetry(options);

      this.logger.log(
        `Provisioned server ${ptServer.identifier} for order ${orderId}`,
      );
      await this.orderService.markServerActive(serverId, ptServer.identifier);
      await job?.updateProgress(50);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to provision server for order ${orderId}: ${message}`,
      );
      await this.orderService.markServerFailed(serverId);
      throw new Error(`Provisioning failed: ${message}`);
    }
  }
}
