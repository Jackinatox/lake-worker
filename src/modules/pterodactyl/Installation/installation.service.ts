/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import { withRetry } from 'src/lib/general/withRetry';
import { trace, Span } from '@opentelemetry/api';

@Injectable()
export class InstallationService {
  private readonly logger = new Logger(InstallationService.name);
  private readonly tracer = trace.getTracer('InstallationService', '1.0.0');
  private readonly ptUrl = process.env.PTERODACTYL_URL!;
  private readonly ptAdminKey = process.env.PTERODACTYL_API_KEY!;

  constructor() {}

  async triggerInstallation(ptAdminId: string): Promise<boolean> {
    return this.tracer.startActiveSpan(
      'triggerInstallation',
      async (span: Span) => {
        span.setAttribute('server.ptAdminId', ptAdminId);

        const result = await withRetry(() => this.reinstallServer(ptAdminId));

        span.setAttribute('install.success', result);
        span.end();
        return result;
      },
    );
  }

  async toggleScripts(
    ptAdminId: string,
    skipScripts: boolean = false,
  ): Promise<boolean> {
    return this.tracer.startActiveSpan('toggleScripts', async (span: Span) => {
      span.setAttribute('server.ptAdminId', ptAdminId);
      span.setAttribute('install.skipScripts', skipScripts);

      const result = await withRetry(() =>
        this._changeInstallScripts(ptAdminId, null, skipScripts),
      );

      span.setAttribute('install.success', result);
      span.end();
      return result;
    });
  }

  async changeDockerImage(
    ptAdminId: string,
    docker_image: string,
  ): Promise<boolean> {
    return this.tracer.startActiveSpan(
      'changeDockerImage',
      async (span: Span) => {
        span.setAttribute('server.ptAdminId', ptAdminId);
        span.setAttribute('docker.image', docker_image);

        const result = await withRetry(() =>
          this._changeInstallScripts(ptAdminId, docker_image, false),
        );

        span.setAttribute('install.success', result);
        span.end();
        return result;
      },
    );
  }

  private async _changeInstallScripts(
    ptAdminId: string,
    docker_image: string | null,
    skipScripts: boolean = false,
  ): Promise<boolean> {
    return this.tracer.startActiveSpan(
      'changeInstallScripts',
      async (span: Span) => {
        span.setAttribute('server.ptAdminId', ptAdminId);
        span.setAttribute('install.skipScripts', skipScripts);
        if (docker_image) {
          span.setAttribute('docker.image', docker_image);
        }

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
            span.setAttribute('error', errorData);
            span.setAttribute('response.status', response.status);
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
            span.end();
            return false;
          }

          span.setAttribute('install.success', true);
        } catch (error) {
          if (error instanceof Error) {
            span.recordException(error);
          }
          this.logger.error(
            'Failed to change server docker image',
            'GAME_SERVER',
            {
              details: { ptAdminId, docker_image, error },
            },
          );
          span.end();
          return false;
        }
        span.end();
        return true;
      },
    );
  }

  private async reinstallServer(ptAdminId: string): Promise<boolean> {
    return this.tracer.startActiveSpan(
      'reinstallServer',
      async (span: Span) => {
        span.setAttribute('server.ptAdminId', ptAdminId);

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
            span.setAttribute('error', errorData);
            span.setAttribute('response.status', response.status);
            this.logger.error(
              'Failed to trigger server reinstall',
              'GAME_SERVER',
              {
                details: {
                  ptAdminId,
                  status: response.status,
                  error: errorData,
                },
              },
            );
            span.end();
            return false;
          }

          span.setAttribute('reinstall.success', true);
        } catch (error) {
          if (error instanceof Error) {
            span.recordException(error);
          }
          this.logger.error(
            'Failed to trigger server reinstall',
            'GAME_SERVER',
            {
              details: { ptAdminId, error },
            },
          );
          span.end();
          return false;
        }
        span.end();
        return true;
      },
    );
  }
}
