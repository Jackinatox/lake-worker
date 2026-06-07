import { Injectable, Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { PterodactylPrismaService } from 'src/core/pterodactyl-prisma.service';
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

  constructor(private readonly ptPrisma: PterodactylPrismaService) {}

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

  private async getServerAllocationsFromDb(
    serverId: string,
  ): Promise<AllocationAttributes[] | null> {
    const server = await this.ptPrisma.servers.findUnique({
      where: { uuidShort: serverId },
      select: {
        allocation_id: true,
        allocations_allocations_server_idToservers: {
          select: {
            id: true,
            ip: true,
            ip_alias: true,
            port: true,
            notes: true,
          },
        },
      },
    });

    if (!server) return null;

    return server.allocations_allocations_server_idToservers.map((a) => ({
      ...a,
      is_default: a.id === server.allocation_id,
    }));
  }

  private async findConsecutiveFreeBasePorts(
    nodeId: number,
    ip: string,
  ): Promise<number[]> {
    const free = await this.ptPrisma.allocations.findMany({
      where: { node_id: nodeId, server_id: null, ip },
      select: { port: true },
      orderBy: { port: 'asc' },
    });

    const ports = free.map((a) => a.port);
    const bases: number[] = [];
    for (let i = 0; i < ports.length - 1; i++) {
      if (ports[i + 1] === ports[i] + 1) {
        bases.push(ports[i]);
      }
    }
    return bases;
  }

  private async setConsecutiveAllocations(
    serverId: string,
    apiKey: string,
    maxAttempts: number = 10,
  ): Promise<AllocationAttributes[]> {
    // Read current state from DB (no API call)
    const current = await this.getServerAllocationsFromDb(serverId);

    if (!current) {
      throw new Error(`Server ${serverId} not found in panel database`);
    }

    const existingPrimary = current.find((a) => a.is_default);

    if (existingPrimary) {
      const alreadyConsecutive = current.some(
        (a) => !a.is_default && a.port === existingPrimary.port + 1,
      );
      if (alreadyConsecutive) {
        this.logger.debug(
          `Server ${serverId} already has consecutive ports ${existingPrimary.port} and ${existingPrimary.port + 1}`,
        );
        return current;
      }
    }

    // Remove all non-primary allocations to start clean (API writes only)
    for (const alloc of current.filter((a) => !a.is_default)) {
      await this.removeAllocation(serverId, alloc.id, apiKey);
    }

    // Query the panel DB for the server's node and all free consecutive pairs
    const serverInfo = await this.ptPrisma.servers.findUnique({
      where: { uuidShort: serverId },
      select: {
        node_id: true,
        allocations_servers_allocation_idToallocations: {
          select: { id: true, ip: true, port: true },
        },
      },
    });

    if (!serverInfo?.allocations_servers_allocation_idToallocations) {
      throw new Error(`Could not resolve node for server ${serverId}`);
    }

    const { node_id: nodeId } = serverInfo;
    const primaryAlloc =
      serverInfo.allocations_servers_allocation_idToallocations;

    const freeBases = await this.findConsecutiveFreeBasePorts(
      nodeId,
      primaryAlloc.ip,
    );

    if (freeBases.length === 0) {
      throw new Error(
        `Node has no consecutive free port pairs available for server ${serverId}`,
      );
    }

    this.logger.debug(
      `Server ${serverId}: node ${nodeId} has ${freeBases.length} consecutive free pair(s). Current primary=${primaryAlloc.port}`,
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Re-read primary from DB (zero API calls for reads)
      const state = await this.getServerAllocationsFromDb(serverId);
      const primary = state?.find((a) => a.is_default);

      if (!primary) {
        throw new Error(`No primary allocation found on server ${serverId}`);
      }

      // Check from DB whether primary+1 is currently free — if not, skip the API call
      const nextPortFreeCount = await this.ptPrisma.allocations.count({
        where: {
          node_id: nodeId,
          ip: primary.ip,
          port: primary.port + 1,
          server_id: null,
        },
      });

      if (nextPortFreeCount === 0) {
        this.logger.debug(
          `Attempt ${attempt}: port ${primary.port + 1} is taken, rotating primary`,
        );
        // Rotate without wasting an assign-then-remove cycle
        const newAlloc = await this.assignAllocation(serverId, apiKey);
        await this.setPrimaryAllocation(serverId, apiKey, newAlloc.id);
        await this.removeAllocation(serverId, primary.id, apiKey);
        continue;
      }

      this.logger.debug(
        `Attempt ${attempt}: primary=${primary.port}, port ${primary.port + 1} is free — assigning`,
      );

      const assigned = await this.assignAllocation(serverId, apiKey);

      if (assigned.port === primary.port + 1) {
        this.logger.log(
          `Server ${serverId}: secured consecutive ports ${primary.port} and ${assigned.port}`,
        );
        return await this.listServerAllocations(serverId, apiKey);
      }

      // Pool gave us a different port despite DB saying primary+1 was free
      // (race condition with another server). Rotate and retry.
      this.logger.debug(
        `Got port ${assigned.port} instead of ${primary.port + 1} (race condition), rotating`,
      );
      await this.setPrimaryAllocation(serverId, apiKey, assigned.id);
      await this.removeAllocation(serverId, primary.id, apiKey);
    }

    throw new Error(
      `Failed to secure consecutive ports for server ${serverId} after ${maxAttempts} attempts`,
    );
  }

  private async setAllocationCount(
    serverId: string,
    targetCount: number,
    apiKey: string,
    requiresConsecutivePorts?: boolean,
  ): Promise<AllocationAttributes[]> {
    return this.tracer.startActiveSpan('setAllocationCount', async (span) => {
      span.setAttribute('server.ptId', serverId);
      span.setAttribute('allocation.targetCount', targetCount);
      span.setAttribute(
        'allocation.requiresConsecutive',
        requiresConsecutivePorts ?? false,
      );

      if (requiresConsecutivePorts && targetCount >= 2) {
        const result = await this.setConsecutiveAllocations(serverId, apiKey);
        span.setAttribute('allocation.finalCount', result.length);
        span.end();
        return result;
      }

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
          requiresConsecutivePorts?: boolean;
          ports: ReadonlyArray<{
            envVar?: string;
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
        valheim: {
          requiredAllocations: 2,
          requiresConsecutivePorts: true,
          ports: [
            {
              notes: 'Reliable Valheim port',
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
        gameConfig.requiresConsecutivePorts,
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

            if (portConfig.envVar) {
              await this.updateServerEnvironmentVariable(
                ptServerId,
                portConfig.envVar,
                allocation.port,
                apiKey,
              );

              portsConfigured.push(`${portConfig.envVar}=${allocation.port}`);
            } else {
              portsConfigured.push(`${portConfig.notes}=${allocation.port}`);
            }
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
