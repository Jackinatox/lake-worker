/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/core/prisma.service';
import { LoggerService } from 'src/core/logger.service';
import { trace, Span } from '@opentelemetry/api';
import { EnvironmentService } from 'src/modules/pterodactyl/Environment/environment.service';
import { PterodactylPortService } from 'src/modules/pterodactyl/Ports/port.service';
import { InstallationService } from 'src/modules/pterodactyl/Installation/installation.service';
import {
  MinecraftGameId,
  SatisfactoryGameId,
  HytaleGameId,
} from 'src/lib/GlobalConsstants';
import {
  HytaleConfig,
  SatisfactoryConfig,
} from 'src/modules/pterodactyl/Environment/GameConfig';
import type { GameConfigBase } from './order.service';

interface ChangeGameInput {
  serverId: string;
  gameId: number;
  gameConfig: GameConfigBase;
  deleteFiles?: boolean;
  userId: string;
}

interface StartupBody {
  skip_scripts: boolean;
  egg: number;
  image: string;
  environment: Record<string, string>;
  startup: string;
}

@Injectable()
export class ChangeGameService {
  private readonly tracer = trace.getTracer('ChangeGameService', '1.0.0');
  private readonly ptUrl = process.env.PTERODACTYL_URL!;
  private readonly ptAdminKey = process.env.PTERODACTYL_API_KEY!;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
    private readonly envService: EnvironmentService,
    private readonly ports: PterodactylPortService,
    private readonly installation: InstallationService,
  ) {}

  async changeGame(input: ChangeGameInput): Promise<{ success: boolean }> {
    return this.tracer.startActiveSpan('changeGame', async (span: Span) => {
      const {
        serverId,
        gameId,
        gameConfig,
        deleteFiles = true,
        userId,
      } = input;

      span.setAttribute('server.ptId', serverId);
      span.setAttribute('game.newId', gameId);
      span.setAttribute('user.id', userId);
      span.setAttribute('deleteFiles', deleteFiles);

      try {
        // 1. Validate server ownership and get server + new game data
        const [gameServer, newGameData, user] = await Promise.all([
          this.prisma.gameServer.findFirst({
            where: {
              ptServerId: serverId,
              userId: userId,
              status: {
                notIn: ['CREATION_FAILED', 'DELETED'],
              },
            },
          }),
          this.prisma.gameData.findUnique({ where: { id: gameId } }),
          this.prisma.user.findUnique({ where: { id: userId } }),
        ]);

        if (!gameServer || !gameServer.ptServerId || !gameServer.ptAdminId) {
          throw new NotFoundException('Server not found or access denied');
        }

        if (!newGameData) {
          throw new NotFoundException('Selected game not found');
        }

        if (!user || !user.ptKey) {
          throw new ForbiddenException(
            'User not authenticated with Pterodactyl',
          );
        }

        span.setAttribute('server.dbId', gameServer.id);
        span.setAttribute('game.name', newGameData.name);

        // 2. Kill the server
        await this.killServer(serverId, user.ptKey);

        // Small delay to ensure server is fully stopped
        await this.delay(200);

        // 3. Build and apply new startup configuration
        const startupBody = this.buildStartupBody(gameConfig, gameId);
        await this.updateServerStartup(gameServer.ptAdminId, startupBody);

        // Small delay before port configuration
        await this.delay(2000);

        // 4. Correct ports for the new game
        await this.ports.correctPorts(
          gameServer.ptServerId,
          newGameData.id,
          user,
        );

        await this.delay(1000);

        // 5. Enable install scripts
        await this.installation.toggleScripts(
          gameServer.ptAdminId.toString(),
          false,
        );

        // 6. Update the database with new game configuration
        await this.prisma.gameServer.update({
          where: { id: gameServer.id },
          data: {
            gameDataId: newGameData.id,
            gameConfig: gameConfig as any,
          },
        });

        await this.delay(500);

        // 7. Reinstall the server
        await this.reinstallServer(serverId, user.ptKey, deleteFiles);

        this.logger.log(
          `Changed game for server ${serverId} to ${newGameData.name} (gameId: ${gameId})`,
        );

        span.setAttribute('changeGame.success', true);
        span.end();

        return { success: true };
      } catch (error) {
        if (error instanceof Error) {
          span.recordException(error);
        }
        span.setAttribute('changeGame.success', false);
        span.end();
        throw error;
      }
    });
  }

  private buildStartupBody(
    gameConfig: GameConfigBase,
    gameId: number,
  ): StartupBody {
    const baseBody = {
      skip_scripts: true,
      egg: gameConfig.eggId,
      image: gameConfig.dockerImage,
    };

    let envConfig: { environment: Record<string, string>; startup: string };

    switch (gameId) {
      case MinecraftGameId:
        envConfig = this.envService.minecraft(
          gameConfig.eggId,
          gameConfig.version,
        );
        break;
      case SatisfactoryGameId:
        envConfig = this.envService.satisfactory(
          gameConfig.gameSpecificConfig as SatisfactoryConfig,
        );
        break;
      case HytaleGameId:
        envConfig = this.envService.hytale(
          gameConfig.gameSpecificConfig as HytaleConfig,
        );
        break;
      default:
        throw new Error(`Unsupported game ID: ${gameId}`);
    }

    return { ...baseBody, ...envConfig };
  }

  private async killServer(serverId: string, userPtKey: string): Promise<void> {
    const response = await fetch(
      `${this.ptUrl}/api/client/servers/${serverId}/power`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userPtKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({ signal: 'kill' }),
      },
    );

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.warn(`Failed to kill server ${serverId}: ${errorData}`);
      // Don't throw - server might already be stopped
    }
  }

  private async updateServerStartup(
    ptAdminId: number,
    body: StartupBody,
  ): Promise<void> {
    const response = await fetch(
      `${this.ptUrl}/api/application/servers/${ptAdminId}/startup`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.ptAdminKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorData = await response.json();
      this.logger.error(
        `Failed to update server startup: ${JSON.stringify(errorData)}`,
      );
      throw new Error(
        `Failed to change game: ${response.status} ${JSON.stringify(errorData)}`,
      );
    }
  }

  private async reinstallServer(
    serverId: string,
    userPtKey: string,
    deleteFiles: boolean,
  ): Promise<void> {
    // Use the client API to reinstall (this respects user permissions)
    const response = await fetch(
      `${this.ptUrl}/api/client/servers/${serverId}/settings/reinstall`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userPtKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify({ delete_files: deleteFiles }),
      },
    );

    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error(`Failed to reinstall server: ${errorData}`);
      throw new Error(
        `Failed to reinstall server: ${response.status} ${errorData}`,
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
