import { Injectable, Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { User } from 'src/generated/prisma/client';

interface AllocationAttributes {
  id: number;
  ip: string;
  ip_alias: string | null;
  port: number;
  notes: string | null;
  is_default: boolean;
}

interface AllocationResponse {
  object: string;
  attributes: AllocationAttributes;
}

interface AllocationListResponse {
  object: string;
  data: AllocationResponse[];
}

interface PortConfigurationResult {
  success: boolean;
  allocations: number;
  portsConfigured: string[];
  error?: string;
  attemptsMade?: number;
}

@Injectable()
export class PterodactylPortService {
  private readonly tracer = trace.getTracer('PterodactylPortService', '1.0.0');
  private readonly logger = new Logger(PterodactylPortService.name);
  private readonly pterodactylUrl = process.env.PTERODACTYL_URL;
  private readonly pterodactylApiKey = process.env.PTERODACTYL_API_KEY;

  private async listServerAllocations(
    serverId: string,
    apiKey: string,
  ): Promise<AllocationAttributes[]> {
    const response = await fetch(
      `${this.pterodactylUrl}/api/client/servers/${serverId}/network/allocations`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/vnd.pterodactyl.v1+json',
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(
        `Failed to list allocations: ${response.status} ${response.statusText} - ${errorData}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const data: AllocationListResponse = await response.json();
    return data.data.map((allocation) => allocation.attributes);
  }

  private async assignAllocation(
    serverId: string,
    apiKey: string,
    ip?: string,
    port?: number,
  ): Promise<AllocationAttributes> {
    const panelUrl = this.pterodactylUrl;

    const body: { ip?: string; port?: number } = {};
    if (ip) body.ip = ip;
    if (port) body.port = port;

    const response = await fetch(
      `${panelUrl}/api/client/servers/${serverId}/network/allocations`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'Application/vnd.pterodactyl.v1+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(
        `Failed to assign allocation: ${response.status} ${response.statusText} - ${errorData}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const data: AllocationResponse = await response.json();
    return data.attributes;
  }

  private async setPrimaryAllocation(
    serverId: string,
    apiKey: string,
    allocationId: number,
  ): Promise<AllocationAttributes> {
    const response = await fetch(
      `${this.pterodactylUrl}/api/client/servers/${serverId}/network/allocations/${allocationId}/primary`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/vnd.pterodactyl.v1+json',
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(
        `Failed to set primary allocation: ${response.status} ${response.statusText} - ${errorData}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const data: AllocationResponse = await response.json();
    return data.attributes;
  }

  private async removeAllocation(
    serverId: string,
    allocationId: number,
    apiKey: string,
  ): Promise<void> {
    const response = await fetch(
      `${this.pterodactylUrl}/api/client/servers/${serverId}/network/allocations/${allocationId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/vnd.pterodactyl.v1+json',
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(
        `Failed to remove allocation: ${response.status} ${response.statusText} - ${errorData}`,
      );
    }
  }

  private async updateAllocationNotes(
    serverId: string,
    apiKey: string,
    allocationId: number,
    notes: string,
  ): Promise<AllocationAttributes> {
    const response = await fetch(
      `${this.pterodactylUrl}/api/client/servers/${serverId}/network/allocations/${allocationId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'Application/vnd.pterodactyl.v1+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notes }),
      },
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(
        `Failed to update allocation notes: ${response.status} ${response.statusText} - ${errorData}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const data: AllocationResponse = await response.json();
    return data.attributes;
  }

  private async setAllocationCount(
    serverId: string,
    targetCount: number,
    apiKey: string,
  ): Promise<AllocationAttributes[]> {
    return this.tracer.startActiveSpan('setAllocationCount', async (span) => {
      span.setAttribute('server.ptId', serverId);
      span.setAttribute('allocation.targetCount', targetCount);

      const currentAllocations = await this.listServerAllocations(
        serverId,
        apiKey,
      );
      const currentCount = currentAllocations.length;

      span.setAttribute('allocation.currentCount', currentCount);

      if (currentCount >= targetCount) {
        this.logger.debug(
          `Server ${serverId} already has ${currentCount} allocations (need ${targetCount}), keeping existing`,
        );
        span.end();
        return currentAllocations;
      }

      // Add allocations to reach target count
      const allocationsToAdd = targetCount - currentCount;
      span.setAttribute('allocation.toAdd', allocationsToAdd);

      for (let i = 0; i < allocationsToAdd; i++) {
        try {
          await this.assignAllocation(serverId, apiKey);
        } catch (error) {
          this.logger.error(
            `Failed to add allocation ${i + 1} of ${allocationsToAdd} to server ${serverId}`,
          );
          span.end();
          throw error;
        }
      }

      // Return updated allocations
      const updatedAllocations = await this.listServerAllocations(
        serverId,
        apiKey,
      );
      span.setAttribute('allocation.finalCount', updatedAllocations.length);
      span.end();
      return updatedAllocations;
    });
  }

  private async updateServerEnvironmentVariable(
    serverId: string,
    envVarName: string,
    value: string | number,
    apiKey: string,
  ): Promise<void> {
    return this.tracer.startActiveSpan('updateServerEnvVar', async (span) => {
      span.setAttribute('server.ptId', serverId);
      span.setAttribute('env.varName', envVarName);
      span.setAttribute('env.value', String(value));

      const response = await fetch(
        `${this.pterodactylUrl}/api/client/servers/${serverId}/startup/variable`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'Application/vnd.pterodactyl.v1+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key: envVarName,
            value: String(value),
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.text();
        this.logger.error(
          `Failed to update environment variable ${envVarName} for server ${serverId}: ${response.status} ${response.statusText} - ${errorData}`,
        );
        span.end();
        return;
      }

      this.logger.log(
        `Updated environment variable ${envVarName} to ${value} for server ${serverId}`,
      );
      span.end();
    });
  }

  async correctPorts(
    ptServerId: string,
    gameSlug: string,
    user: User,
    maxRetries: number = 4,
  ): Promise<PortConfigurationResult> {
    let lastError: Error | undefined;
    return await this.tracer.startActiveSpan('correctPorts', async (span) => {
      span.setAttribute('server.ptId', ptServerId);
      span.setAttribute('game.slug', gameSlug);
      span.setAttribute('retry.maxAttempts', maxRetries);

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const result = await this.configureServerPorts(
            ptServerId,
            gameSlug,
            user.ptKey!,
          );

          span.setAttribute('retry.actualAttempts', attempt);
          span.setAttribute('port.allocations', result.allocations);
          span.setAttribute('port.configured', result.portsConfigured.length);

          return {
            ...result,
            attemptsMade: attempt,
          };
        } catch (error) {
          if (error instanceof Error) {
            span.recordException(error);
            lastError = error;
          } else {
            lastError = new Error('Unknown error');
          }
          this.logger.warn(
            `Port configuration attempt ${attempt}/${maxRetries} failed for server ${ptServerId}: ${lastError.message}`,
          );

          if (attempt < maxRetries) {
            const delayMs = Math.min(5000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s

            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }

      span.setAttribute('retry.actualAttempts', maxRetries);
      span.setAttribute('error', lastError?.message || 'Unknown error');

      this.logger.error(
        `All ${maxRetries} port configuration attempts failed for server ${ptServerId}`,
      );

      span.end();
      return {
        success: false,
        allocations: 0,
        portsConfigured: [],
        error: lastError?.message || 'Unknown error',
        attemptsMade: maxRetries,
      };
    });
  }

  private async configureServerPorts(
    ptServerId: string,
    gameSlug: string,
    apiKey: string,
  ): Promise<Omit<PortConfigurationResult, 'attemptsMade'>> {
    return this.tracer.startActiveSpan('configureServerPorts', async (span) => {
      span.setAttribute('server.ptId', ptServerId);
      span.setAttribute('game.slug', gameSlug);

      this.logger.debug(
        `Starting port configuration for server ${ptServerId}, game ${gameSlug}`,
      );

      const GAME_PORT_CONFIG: Record<
        string,
        {
          requiredAllocations: number;
          ports: ReadonlyArray<{
            envVar: string;
            notes: string;
            isSecondary: boolean;
          }>;
        }
      > = {
        minecraft: {
          requiredAllocations: 1,
          ports: [],
        },
        satisfactory: {
          requiredAllocations: 2,
          ports: [
            {
              envVar: 'RELIABLE_PORT',
              notes: 'Satisfactory Reliable Port',
              isSecondary: true,
            },
          ],
        },
        hytale: {
          requiredAllocations: 2,
          ports: [
            {
              envVar: 'QUERY_PORT',
              notes: 'Hytale Source Query Port',
              isSecondary: true,
            },
          ],
        },
      };

      const gameConfig = GAME_PORT_CONFIG[gameSlug] ?? {
        requiredAllocations: 1,
        ports: [],
      };

      if (!GAME_PORT_CONFIG[gameSlug]) {
        this.logger.warn(
          `No port configuration found for game slug: ${gameSlug}, using default (1 allocation, no extra ports)`,
        );
      }

      span.setAttribute(
        'port.requiredAllocations',
        gameConfig.requiredAllocations,
      );
      span.setAttribute('port.portsToConfig', gameConfig.ports.length);

      this.logger.log(
        `Ensuring server has ${gameConfig.requiredAllocations} allocations`,
      );

      const allocations = await this.setAllocationCount(
        ptServerId,
        gameConfig.requiredAllocations,
        apiKey,
      );

      span.setAttribute('port.actualAllocations', allocations.length);

      const primaryAllocation = allocations.find((a) => a.is_default);
      if (primaryAllocation) {
        await this.updateAllocationNotes(
          ptServerId,
          apiKey,
          primaryAllocation.id,
          'Primary Game Port',
        );
      }

      const portsConfigured: string[] = [];

      if (
        gameConfig.ports.length > 0 &&
        allocations.length >= gameConfig.requiredAllocations
      ) {
        const secondaryAllocations = allocations.filter((a) => !a.is_default);

        for (let i = 0; i < gameConfig.ports.length; i++) {
          const portConfig = gameConfig.ports[i];

          if (portConfig.isSecondary && secondaryAllocations[i]) {
            const allocation = secondaryAllocations[i];

            await this.updateAllocationNotes(
              ptServerId,
              apiKey,
              allocation.id,
              portConfig.notes,
            );

            await this.updateServerEnvironmentVariable(
              ptServerId,
              portConfig.envVar,
              allocation.port,
              apiKey,
            );

            portsConfigured.push(`${portConfig.envVar}=${allocation.port}`);
          }
        }
      }

      span.setAttribute('port.configuredCount', portsConfigured.length);

      this.logger.log(
        `Port configuration completed for server ${ptServerId}. Allocations: ${allocations.length}, Ports configured: ${portsConfigured.length}`,
      );

      span.end();
      return {
        success: true,
        allocations: allocations.length,
        portsConfigured,
      };
    });
  }
}
