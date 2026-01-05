/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/core/prisma.service';
import { GameServerType, OrderType, Prisma } from 'src/generated/prisma/client';
import { EnvironmentService } from '../pterodactyl/Environment/environment.service';
import {
  calcBackups,
  calcDiskSize,
} from 'src/lib/pterodactyl/provision/ptResourceLogic';
import { MinecraftGameId, SatisfactoryGameId } from 'src/lib/GlobalConsstants';
import { Builder, NewServerOptions, Server } from '@avionrx/pterodactyl-js';
import { withRetry } from 'src/lib/general/withRetry';
import { Job } from 'bullmq';

type GameServerOrder = Prisma.GameServerOrderGetPayload<{
  include: {
    creationGameData: true;
    creationLocation: true;
    user: true;
  };
}>;

@Injectable()
export class PterodactylService {
  private readonly logger = new Logger(PterodactylService.name);
  private readonly pt = new Builder()
    .setURL(process.env.PTERODACTYL_URL!)
    .setAPIKey(process.env.PTERODACTYL_API_KEY!)
    .asAdmin();

  constructor(
    private prisma: PrismaService,
    private env: EnvironmentService,
  ) {}

  async provisionServer(order: GameServerOrder, job?: Job): Promise<string> {
    const serverOrder = await this.prisma.gameServerOrder.findUniqueOrThrow({
      where: {
        id: order.id,
        creationGameDataId: { not: null },
        creationLocationId: { not: null },
      },
      include: {
        user: true,
        creationGameData: true,
        creationLocation: true,
      },
    });

    if (
      !serverOrder.user.ptKey ||
      !serverOrder.creationGameData ||
      !serverOrder.creationLocation
    ) {
      throw new Error(`No Server found for serverOrder: ${order.id}`);
    }

    const gameConfig = serverOrder.gameConfig as any;

    const preOptions = {
      user: serverOrder.user.ptUserId,
      limits: {
        cpu: serverOrder.cpuPercent,
        disk: calcDiskSize(serverOrder.cpuPercent, serverOrder.ramMB),
        memory: serverOrder.ramMB,
        io: 500,
        swap: 512,
      },
      egg: gameConfig.eggId,
      startWhenInstalled: false,
      outOfMemoryKiller: false,
      featureLimits: {
        allocations: 2,
        backups: calcBackups(serverOrder.cpuPercent, serverOrder.ramMB),
        databases: 0,
        split_limit: 0,
      },
      deploy: {
        dedicatedIp: false,
        locations: [serverOrder.creationLocation.ptLocationId],
        portRange: [],
      },
      image: gameConfig.dockerImage,
    };

    let startAndVars;
    switch (serverOrder.creationGameData.id) {
      case MinecraftGameId:
        startAndVars = this.env.minecraft(
          parseInt(gameConfig.eggId),
          gameConfig.version,
        );
        break;
      case SatisfactoryGameId:
        startAndVars = this.env.satisfactory(gameConfig.gameSpecificConfig); // has type SatisfactoryConfig
        break;
      default:
        throw new Error(
          `No Handler for: ${serverOrder.creationGameData.name} (${serverOrder.creationGameData.id})`,
        );
    }

    await job?.updateProgress(30);

    const serverName = serverOrder.creationGameData.name + ' Gameserver';
    const newOptions = {
      name: serverName,
      ...preOptions,
      ...startAndVars,
    } as NewServerOptions;

    const enumMap: Record<OrderType, GameServerType> = {
      [OrderType.DOWNGRADE]: GameServerType.CUSTOM,
      [OrderType.FREE_SERVER]: GameServerType.FREE,
      [OrderType.NEW]: GameServerType.CUSTOM,
      [OrderType.RENEW]: GameServerType.CUSTOM,
      [OrderType.TO_PAYED]: GameServerType.CUSTOM,
      [OrderType.UPGRADE]: GameServerType.CUSTOM,
      [OrderType.PACKAGE]: GameServerType.PACKAGE,
    };

    const dbNewServer = await this.prisma.gameServer.create({
      data: {
        status: 'CREATED',
        backupCount: preOptions.featureLimits.backups,
        cpuPercent: preOptions.limits.cpu,
        diskMB: preOptions.limits.disk,
        price: serverOrder.price,
        ramMB: preOptions.limits.memory,
        expires: serverOrder.expiresAt,
        userId: serverOrder.user.id,
        gameDataId: serverOrder.creationGameData.id,
        locationId: serverOrder.creationLocation.ptLocationId,
        gameConfig: serverOrder.gameConfig || undefined,
        name: serverName,
        type: enumMap[serverOrder.type],
      },
    });

    withRetry(() => this.createServer(newOptions), {
      maxAttempts: 3,
      delayMs: 5000,
    })
      .then(async (ptServer) => {
        this.logger.log(
          `Provisioned server ${ptServer.identifier} for order ${serverOrder.id}`,
        );
        await this.prisma.gameServer.update({
          where: { id: dbNewServer.id },
          data: { ptServerId: ptServer.identifier, status: 'ACTIVE' },
        });

        await job?.updateProgress(50);

        return ptServer;
      })
      .catch(async (error) => {
        this.logger.error(
          `Failed to provision server for order ${serverOrder.id}: ${error.message}`,
        );
        await this.prisma.gameServer.update({
          where: { id: dbNewServer.id },
          data: { status: 'CREATION_FAILED' },
        });
      });
    throw new Error('Provisioning failed');
  }

  async createServer(options: NewServerOptions): Promise<Server> {
    return await this.pt.createServer({ ...options, skipScripts: true });
  }
}
