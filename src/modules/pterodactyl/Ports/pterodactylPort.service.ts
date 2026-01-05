import { Injectable, Logger } from '@nestjs/common';
import { getPanelUrl } from 'src/lib/GlobalConsstants';

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
  private readonly logger = new Logger(PterodactylPortService.name);

  private async listServerAllocations(
    serverId: string,
    apiKey: string,
  ): Promise<AllocationAttributes[]> {
    const panelUrl = getPanelUrl();

    const response = await fetch(
      `${panelUrl}/api/client/servers/${serverId}/network/allocations`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'Application/vnd.pterodactyl.v1+json',
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
    const panelUrl = getPanelUrl();

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
    const panelUrl = getPanelUrl();

    const response = await fetch(
      `${panelUrl}/api/client/servers/${serverId}/network/allocations/${allocationId}/primary`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'Application/vnd.pterodactyl.v1+json',
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
    apiKey: string,
    allocationId: number,
  ): Promise<void> {
    const panelUrl = getPanelUrl();

    const response = await fetch(
      `${panelUrl}/api/client/servers/${serverId}/network/allocations/${allocationId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'Application/vnd.pterodactyl.v1+json',
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
    const panelUrl = getPanelUrl();

    const response = await fetch(
      `${panelUrl}/api/client/servers/${serverId}/network/allocations/${allocationId}`,
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
    apiKey: string,
    targetCount: number,
  ): Promise<AllocationAttributes[]> {
    const currentAllocations = await this.listServerAllocations(
      serverId,
      apiKey,
    );
    const currentCount = currentAllocations.length;

    if (currentCount === targetCount) {
      this.logger.debug(
        `Server ${serverId} already has ${targetCount} allocations`,
      );
      return currentAllocations;
    }

    if (currentCount < targetCount) {
      // Add allocations
      const allocationsToAdd = targetCount - currentCount;

      for (let i = 0; i < allocationsToAdd; i++) {
        try {
          await this.assignAllocation(serverId, apiKey);
        } catch (error) {
          this.logger.error(
            `Failed to add allocation ${i + 1} of ${allocationsToAdd} to server ${serverId}`,
          );
          throw error;
        }
      }
    } else {
      // Remove allocations (cannot remove primary)
      const allocationsToRemove = currentCount - targetCount;

      const nonPrimaryAllocations = currentAllocations.filter(
        (a) => !a.is_default,
      );

      if (nonPrimaryAllocations.length < allocationsToRemove) {
        throw new Error(
          `Cannot remove ${allocationsToRemove} allocations - only ${nonPrimaryAllocations.length} non-primary allocations available`,
        );
      }

      for (let i = 0; i < allocationsToRemove; i++) {
        try {
          await this.removeAllocation(
            serverId,
            apiKey,
            nonPrimaryAllocations[i].id,
          );
        } catch (error) {
          this.logger.error(
            `Failed to remove allocation ${i + 1} of ${allocationsToRemove} from server ${serverId}`,
          );
          throw error;
        }
      }
    }

    // Return updated allocations
    return await this.listServerAllocations(serverId, apiKey);
  }

  private async updateServerEnvironmentVariable(
    serverId: string,
    apiKey: string,
    envVarName: string,
    value: string | number,
  ): Promise<void> {
    const panelUrl = getPanelUrl();

    const response = await fetch(
      `${panelUrl}/api/client/servers/${serverId}/startup/variable`,
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
      return;
    }

    this.logger.log(
      `Updated environment variable ${envVarName} to ${value} for server ${serverId}`,
    );
  }

  async correctPorts(
    ptServerId: string,
    gameId: number,
    apiKey: string,
    maxRetries: number = 4,
  ): Promise<PortConfigurationResult> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.configureServerPorts(
          ptServerId,
          gameId,
          apiKey,
        );

        return {
          ...result,
          attemptsMade: attempt,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        this.logger.warn(
          `Port configuration attempt ${attempt}/${maxRetries} failed for server ${ptServerId}: ${lastError.message}`,
        );

        if (attempt < maxRetries) {
          const delayMs = Math.min(5000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s

          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    this.logger.error(
      `All ${maxRetries} port configuration attempts failed for server ${ptServerId}`,
    );

    return {
      success: false,
      allocations: 0,
      portsConfigured: [],
      error: lastError?.message || 'Unknown error',
      attemptsMade: maxRetries,
    };
  }

  private async configureServerPorts(
    ptServerId: string,
    gameId: number,
    apiKey: string,
  ): Promise<Omit<PortConfigurationResult, 'attemptsMade'>> {
    this.logger.debug(
      `Starting port configuration for server ${ptServerId}, game ${gameId}`,
    );

    const GAME_PORT_CONFIG = {
      1: {
        requiredAllocations: 1,
        ports: [],
      },
      2: {
        requiredAllocations: 2,
        ports: [
          {
            envVar: 'RELIABLE_PORT',
            notes: 'Satisfactory Reliable Port',
            isSecondary: true,
          },
        ],
      },
    } as const;

    const gameConfig =
      GAME_PORT_CONFIG[gameId as keyof typeof GAME_PORT_CONFIG];

    if (!gameConfig) {
      throw new Error(`No port configuration found for game ID: ${gameId}`);
    }

    this.logger.log(
      `Ensuring server has ${gameConfig.requiredAllocations} allocations`,
    );

    const allocations = await this.setAllocationCount(
      ptServerId,
      apiKey,
      gameConfig.requiredAllocations,
    );

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

          await this.updateServerEnvironmentVariable(
            ptServerId,
            apiKey,
            portConfig.envVar,
            allocation.port,
          );

          portsConfigured.push(`${portConfig.envVar}=${allocation.port}`);
        }
      }
    }

    this.logger.log(
      `Port configuration completed for server ${ptServerId}. Allocations: ${allocations.length}, Ports configured: ${portsConfigured.length}`,
    );

    return {
      success: true,
      allocations: allocations.length,
      portsConfigured,
    };
  }
}
