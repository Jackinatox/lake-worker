/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/core/prisma.service';
import { LoggerService } from 'src/core/logger.service';
import { trace, Span } from '@opentelemetry/api';
import { EnvironmentService } from '../../pterodactyl/Environment/environment.service';
import { PterodactylPortService } from '../../pterodactyl/Ports/port.service';
import { InstallationService } from '../../pterodactyl/Installation/installation.service';
import {
  FactorioConfig,
  HytaleConfig,
  MinecraftConfig,
  SatisfactoryConfig,
} from '../../pterodactyl/Environment/GameConfig';
import type { GameConfigBase } from './order.service';

interface ChangeGameInput {
  ptServerId: string;
  gameSlug: string;
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
        ptServerId,
        gameSlug,
        gameConfig,
        deleteFiles = true,
        userId,
      } = input;

      span.setAttribute('server.ptId', ptServerId);
      span.setAttribute('game.newSlug', gameSlug);
      span.setAttribute('user.id', userId);
      span.setAttribute('deleteFiles', deleteFiles);

      try {
        // 1. Validate server ownership and get server + new game data
        const [gameServer, newGameData] = await Promise.all([
          this.prisma.gameServer.findFirst({
            where: {
              ptServerId: ptServerId,
              userId: userId,
              status: {
                notIn: ['CREATION_FAILED', 'DELETED'],
              },
            },
            include: {
              user: true,
            },
          }),
          this.prisma.gameData.findUnique({ where: { slug: gameSlug } }),
        ]);

        if (!gameServer || !gameServer.ptServerId || !gameServer.ptAdminId) {
          throw new NotFoundException('Server not found or access denied');
        }

        if (!newGameData) {
          throw new NotFoundException('Selected game not found');
        }

        if (!gameServer.user || !gameServer.user.ptKey) {
          throw new ForbiddenException(
            'User not authenticated with Pterodactyl',
          );
        }

        span.setAttribute('server.dbId', gameServer.id);
        span.setAttribute('game.name', newGameData.name);

        // 2. Kill the server
        await this.killServer(ptServerId, gameServer.user.ptKey);

        // Small delay to ensure server is fully stopped
        await this.delay(200);

        // 3. Build and apply new startup configuration
        const startupBody = this.buildStartupBody(gameConfig, newGameData.slug);
        await this.updateServerStartup(gameServer.ptAdminId, startupBody);

        // Small delay before port configuration
        await this.delay(2000);

        // 4. Correct ports for the new game
        await this.ports.correctPorts(
          gameServer.ptServerId,
          newGameData.slug,
          gameServer.user,
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
        if (deleteFiles) {
          await this.DeleteAllFilesUserServer(
            gameServer.ptServerId,
            gameServer.user.ptKey,
          );
          await this.delay(500);
        }

        // 7. Reinstall the server
        await this.reinstallServer(ptServerId, gameServer.user.ptKey);

        this.logger.log(
          `Changed game for server ${ptServerId} to ${newGameData.name} (gameSlug: ${gameSlug})`,
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
    gameSlug: string,
  ): StartupBody {
    const baseBody = {
      skip_scripts: true,
      egg: gameConfig.eggId,
      image: gameConfig.dockerImage,
    };

    let envConfig: { environment: Record<string, string>; startup: string };

    switch (gameSlug) {
      case 'minecraft': {
        const mcConfig = gameConfig.gameSpecificConfig as MinecraftConfig;
        envConfig = this.envService.minecraft(
          mcConfig.flavor,
          gameConfig.version,
        );
        break;
      }
      case 'satisfactory':
        envConfig = this.envService.satisfactory(
          gameConfig.gameSpecificConfig as SatisfactoryConfig,
        );
        break;
      case 'hytale':
        envConfig = this.envService.hytale(
          gameConfig.gameSpecificConfig as HytaleConfig,
        );
        break;
      case 'factorio':
        envConfig = this.envService.factorio(
          gameConfig.gameSpecificConfig as FactorioConfig,
        );
        break;
      default:
        throw new Error(`Unsupported game slug: ${gameSlug}`);
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
  ): Promise<void> {
    // Use the client API to reinstall (this respects user permissions)
    console.log('delete files over PT API');
    const response = await fetch(
      `${this.ptUrl}/api/client/servers/${serverId}/settings/reinstall`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userPtKey}`,
          Accept: 'application/json',
        },
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

  private async DeleteAllFilesUserServer(server: string, apiKey: string) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    };

    const response = await fetch(
      `${this.ptUrl}/api/client/servers/${server}/files/list`,
      {
        method: 'GET',
        headers: headers,
      },
    );

    if (!response.ok) {
      throw new Error(`Error fetching file list: ${response.statusText}`);
    }

    console.log(`Deleting all Files for server ${server}`);

    const data = await response.json();
    const files = data.data;

    const toDelete = files
      .filter((path: string) => path !== '/')
      .map((file: any) => file.attributes.name);

    const deleted = await fetch(
      `${this.ptUrl}/api/client/servers/${server}/files/delete`,
      {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          root: '/',
          files: toDelete,
        }),
      },
    );

    return deleted;
  }
}
