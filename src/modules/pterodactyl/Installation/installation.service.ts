/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { withRetry } from 'src/lib/general/withRetry';
import { getPanelUrl } from 'src/lib/GlobalConsstants';

@Injectable()
export class InstallationService {
  private readonly logger = new Logger(InstallationService.name);

  constructor() {}

  async toggleScripts(
    ptAdminId: string,
    skipScripts: boolean = false,
  ): Promise<boolean> {
    return withRetry(() =>
      this._changeInstallScripts(ptAdminId, null, skipScripts),
    );
  }

  async changeDockerImage(
    ptAdminId: string,
    docker_image: string,
  ): Promise<boolean> {
    return withRetry(() =>
      this._changeInstallScripts(ptAdminId, docker_image, false),
    );
  }

  private async _changeInstallScripts(
    ptAdminId: string,
    docker_image: string | null,
    skipScripts: boolean = false,
  ): Promise<boolean> {
    const ptUrl = getPanelUrl();
    const ptAdminKey = ''; // TODO: Take care of admin key
    try {
      // Get full server details with admin API
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const adminServer = await fetch(
        `${ptUrl}/api/application/servers/${ptAdminId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${ptAdminKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        },
      )
        .then((response) => response.json())
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
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
        `${ptUrl}/api/application/servers/${ptAdminId}/startup`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${ptAdminKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body,
        },
      );

      if (!response.ok) {
        const errorData = await response.text();
        this.logger.error(
          'Failed to change server docker image',
          'GAME_SERVER',
          {
            details: {
              ptAdminId,
              docker_image,
              status: response.status,
              error: errorData,
            },
          },
        );
        return false;
      }
    } catch (error) {
      this.logger.error('Failed to change server docker image', 'GAME_SERVER', {
        details: { ptAdminId, docker_image, error },
      });
      return false;
    }
    return true;
  }
}
