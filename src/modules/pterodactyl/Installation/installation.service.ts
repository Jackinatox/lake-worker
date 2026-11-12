/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/core/logger.service';
import { LogType } from 'src/generated/prisma/client';
import { withRetry } from 'src/lib/general/withRetry';

@Injectable()
export class InstallationService {
  private readonly ptUrl = process.env.PTERODACTYL_URL!;
  private readonly ptAdminKey = process.env.PTERODACTYL_API_KEY!;

  constructor(private readonly logger: LoggerService) {}

  async triggerInstallation(ptAdminId: string): Promise<boolean> {
    const result = await withRetry(() => this.reinstallServer(ptAdminId));

    this.logger.debug('Installation triggered', {
      ...this.base(),
      ptAdminId,
      success: result,
    });
    return result;
  }

  async toggleScripts(
    ptAdminId: string,
    skipScripts: boolean = false,
  ): Promise<boolean> {
    const result = await withRetry(() =>
      this._changeInstallScripts(ptAdminId, null, skipScripts),
    );

    this.logger.debug('Install scripts toggled', {
      ...this.base(),
      ptAdminId,
      skipScripts,
      success: result,
    });
    return result;
  }

  async changeDockerImage(
    ptAdminId: string,
    docker_image: string,
  ): Promise<boolean> {
    const result = await withRetry(() =>
      this._changeInstallScripts(ptAdminId, docker_image, false),
    );

    this.logger.debug('Docker image changed', {
      ...this.base(),
      ptAdminId,
      dockerImage: docker_image,
      success: result,
    });
    return result;
  }

  /**
   * Shared attribution for this service. The game server and user ids are not
   * arguments here — they come from the ambient log context opened by whoever
   * started the provisioning / port / game-change work.
   */
  private base() {
    return {
      component: InstallationService.name,
      logType: LogType.GAME_SERVER,
    } as const;
  }

  private async _changeInstallScripts(
    ptAdminId: string,
    docker_image: string | null,
    skipScripts: boolean = false,
  ): Promise<boolean> {
    try {
      // Get full server details with admin API
      const adminServer = await fetch(
        `${this.ptUrl}/api/application/servers/${ptAdminId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.ptAdminKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        },
      )
        .then((response) => response.json())
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        .then((server) => server.attributes);

      const body = JSON.stringify({
        skip_scripts: skipScripts,
        egg: adminServer.egg,
        environment: adminServer.container.environment,
        startup: adminServer.container.startup_command,
        image: docker_image || adminServer.container.image,
      });

      // Update the server Configuration
      const response = await fetch(
        `${this.ptUrl}/api/application/servers/${ptAdminId}/startup`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${this.ptAdminKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body,
        },
      );

      if (!response.ok) {
        const errorData = await response.text();
        this.logger.error('Failed to change server docker image', {
          ...this.base(),
          details: {
            ptAdminId,
            docker_image,
            skipScripts,
            status: response.status,
            error: errorData,
          },
        });
        return false;
      }
    } catch (error) {
      this.logger.error('Failed to change server docker image', {
        ...this.base(),
        details: { ptAdminId, docker_image, skipScripts, error },
      });
      return false;
    }
    return true;
  }

  private async reinstallServer(ptAdminId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.ptUrl}/api/application/servers/${ptAdminId}/reinstall`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.ptAdminKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        const errorData = await response.text();
        this.logger.error('Failed to trigger server reinstall', {
          ...this.base(),
          details: {
            ptAdminId,
            status: response.status,
            error: errorData,
          },
        });
        return false;
      }
    } catch (error) {
      this.logger.error('Failed to trigger server reinstall', {
        ...this.base(),
        details: { ptAdminId, error },
      });
      return false;
    }
    return true;
  }
}
