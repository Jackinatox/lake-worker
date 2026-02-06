import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/core/prisma.service';
import { GameServerType, OrderType, Prisma } from 'src/generated/prisma/client';
import {
  FactorioConfig,
  HytaleConfig,
  MinecraftConfig,
  SatisfactoryConfig,
} from 'src/modules/pterodactyl/Environment/GameConfig';

export type GameServerOrder = Prisma.GameServerOrderGetPayload<{
  include: {
    creationGameData: true;
    creationLocation: true;
    user: true;
  };
}>;

export interface ValidatedOrder {
  order: GameServerOrder;
  gameConfig: GameConfigBase;
}

export interface GameConfigBase {
  gameId: number;
  eggId: number;
  version: string;
  dockerImage: string;
  gameSpecificConfig:
    | SatisfactoryConfig
    | MinecraftConfig
    | FactorioConfig
    | HytaleConfig;
}

const ORDER_TYPE_TO_SERVER_TYPE: Record<OrderType, GameServerType> = {
  [OrderType.DOWNGRADE]: GameServerType.CUSTOM,
  [OrderType.FREE_SERVER]: GameServerType.FREE,
  [OrderType.NEW]: GameServerType.CUSTOM,
  [OrderType.RENEW]: GameServerType.CUSTOM,
  [OrderType.TO_PAYED]: GameServerType.CUSTOM,
  [OrderType.UPGRADE]: GameServerType.CUSTOM,
  [OrderType.PACKAGE]: GameServerType.PACKAGE,
};

/**
 * Handles order validation and database operations for game servers.
 * Single Responsibility: Only handles order/server data operations.
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getValidatedOrder(orderId: number): Promise<ValidatedOrder> {
    const order = await this.prisma.gameServerOrder.findUniqueOrThrow({
      where: {
        id: orderId,
        creationGameDataId: { not: null },
        creationLocationId: { not: null },
      },
      include: {
        user: true,
        creationGameData: true,
        creationLocation: true,
      },
    });

    this.validateOrder(order as GameServerOrder);

    return {
      order: order as GameServerOrder,
      gameConfig: order.gameConfig as any as GameConfigBase,
    };
  }

  private validateOrder(order: GameServerOrder): void {
    if (!order.user.ptKey) {
      throw new Error(`User ${order.userId} has no Pterodactyl key`);
    }
    if (!order.creationGameData) {
      throw new Error(`Order ${order.id} has no game data`);
    }
    if (!order.creationLocation) {
      throw new Error(`Order ${order.id} has no location`);
    }
  }

  async createGameServerRecord(order: GameServerOrder): Promise<string> {
    const serverName = `${order.creationGameData!.name} Gameserver`;

    const dbServer = await this.prisma.gameServer.create({
      data: {
        status: 'CREATED',
        backupCount: 0, // Will be updated after PT server creation
        cpuPercent: order.cpuPercent,
        diskMB: order.diskMB,
        price: order.price,
        ramMB: order.ramMB,
        expires: order.expiresAt,
        userId: order.user.id,
        gameDataId: order.creationGameData!.id,
        locationId: order.creationLocation!.ptLocationId,
        gameConfig: order.gameConfig || undefined,
        name: serverName,
        type: ORDER_TYPE_TO_SERVER_TYPE[order.type],
      },
    });

    this.logger.log(
      `Created game server record ${dbServer.id} for order ${order.id}`,
    );
    return dbServer.id;
  }

  async markServerActive(
    serverId: string,
    ptServerId: string,
    ptAdminId: number,
    orderId: number,
  ): Promise<void> {
    await this.prisma.gameServer.update({
      where: { id: serverId },
      data: { ptServerId, status: 'ACTIVE', ptAdminId: ptAdminId },
    });

    await this.prisma.gameServerOrder.update({
      where: { id: orderId },
      data: { gameServerId: serverId },
    });
    this.logger.log(
      `Server ${serverId} marked as ACTIVE with PT ID ${ptServerId} and PT Admin ID ${ptAdminId}`,
    );
  }

  async markServerFailed(serverId: string, error?: string): Promise<void> {
    await this.prisma.gameServer.update({
      where: { id: serverId },
      data: { status: 'CREATION_FAILED', errorText: error || null },
    });
    this.logger.warn(`Server ${serverId} marked as CREATION_FAILED`);
  }
}
