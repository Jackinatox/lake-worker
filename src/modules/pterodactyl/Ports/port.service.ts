import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/core/logger.service';
import { PterodactylPrismaService } from 'src/core/pterodactyl-prisma.service';
import { LogType, User } from 'src/generated/prisma/client';
import { GAME_PORT_CONFIG, getGamePortConfig } from './game-ports';

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
  private readonly pterodactylUrl = process.env.PTERODACTYL_URL;
  private readonly pterodactylApiKey = process.env.PTERODACTYL_API_KEY;

  constructor(
    private readonly ptPrisma: PterodactylPrismaService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Shared attribution for this service. The game server and user ids come
   * from the ambient log context opened by the caller (provisioning, the
   * ports controller, or a game change), not from arguments here.
   */
  private base() {
    return {
      component: PterodactylPortService.name,
      logType: LogType.GAME_SERVER,
    } as const;
  }

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

  /**
   * Raises the server's Pterodactyl allocation limit to `minimum` if it is lower.
   * Never lowers it: the limit is what the customer paid for (set by lake / provisioning).
   * A `null` limit means unlimited.
   */
  async ensureAllocationLimit(
    ptServerId: string,
    minimum: number,
  ): Promise<void> {
    const server = await this.ptPrisma.servers.findUnique({
      where: { uuidShort: ptServerId },
      select: {
        id: true,
        allocation_id: true,
        memory: true,
        swap: true,
        disk: true,
        io: true,
        cpu: true,
        threads: true,
        oom_disabled: true,
        allocation_limit: true,
        database_limit: true,
        backup_limit: true,
      },
    });

    if (!server) {
      throw new Error(`Server ${ptServerId} not found in panel database`);
    }
    if (
      server.allocation_limit === null ||
      server.allocation_limit >= minimum
    ) {
      return;
    }

    // PATCH /build replaces the whole build, so every other value is sent back unchanged.
    const response = await fetch(
      `${this.pterodactylUrl}/api/application/servers/${server.id}/build`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.pterodactylApiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          allocation: server.allocation_id,
          memory: server.memory,
          swap: server.swap,
          disk: server.disk,
          io: server.io,
          cpu: server.cpu,
          threads: server.threads,
          oom_disabled: server.oom_disabled === 1,
          feature_limits: {
            allocations: minimum,
            databases: server.database_limit,
            backups: server.backup_limit,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(
        `Failed to raise allocation limit: ${response.status} ${response.statusText} - ${errorData}`,
      );
    }

    this.logger.log(
      `Raised allocation limit of server ${ptServerId} from ${server.allocation_limit} to ${minimum}`,
      {
        ...this.base(),
        ptServerId,
        previousLimit: server.allocation_limit,
        newLimit: minimum,
      },
    );
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
          { ...this.base(), ptServerId: serverId },
        );
        return current;
      }
    }

    // Extra ports the tier allows are removed to make room for the search and
    // re-added (with new numbers) once the consecutive pair is secured.
    const originalCount = current.length;

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
      { ...this.base(), ptServerId: serverId, nodeId },
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
          { ...this.base(), ptServerId: serverId, attempt },
        );
        // Rotate without wasting an assign-then-remove cycle
        const newAlloc = await this.assignAllocation(serverId, apiKey);
        await this.setPrimaryAllocation(serverId, apiKey, newAlloc.id);
        await this.removeAllocation(serverId, primary.id, apiKey);
        continue;
      }

      this.logger.debug(
        `Attempt ${attempt}: primary=${primary.port}, port ${primary.port + 1} is free — assigning`,
        { ...this.base(), ptServerId: serverId, attempt },
      );

      const assigned = await this.assignAllocation(serverId, apiKey);

      if (assigned.port === primary.port + 1) {
        this.logger.log(
          `Server ${serverId}: secured consecutive ports ${primary.port} and ${assigned.port}`,
          { ...this.base(), ptServerId: serverId },
        );
        await this.restoreExtraAllocations(serverId, apiKey, originalCount);
        return await this.listServerAllocations(serverId, apiKey);
      }

      // Pool gave us a different port despite DB saying primary+1 was free
      // (race condition with another server). Rotate and retry.
      this.logger.debug(
        `Got port ${assigned.port} instead of ${primary.port + 1} (race condition), rotating`,
        { ...this.base(), ptServerId: serverId, attempt },
      );
      await this.setPrimaryAllocation(serverId, apiKey, assigned.id);
      await this.removeAllocation(serverId, primary.id, apiKey);
    }

    throw new Error(
      `Failed to secure consecutive ports for server ${serverId} after ${maxAttempts} attempts`,
    );
  }

  /**
   * Tops the server back up to `targetCount` allocations after the consecutive-port
   * search removed its extras. Best effort: the game already has its ports, so a
   * failure here is logged, not thrown.
   */
  private async restoreExtraAllocations(
    serverId: string,
    apiKey: string,
    targetCount: number,
  ): Promise<void> {
    const current = await this.getServerAllocationsFromDb(serverId);
    const missing = targetCount - (current?.length ?? targetCount);

    for (let i = 0; i < missing; i++) {
      try {
        await this.assignAllocation(serverId, apiKey);
      } catch (error) {
        this.logger.warn(
          `Could not restore extra allocation ${i + 1} of ${missing} on server ${serverId}`,
          { ...this.base(), ptServerId: serverId, targetCount, error },
        );
        return;
      }
    }
  }

  private async setAllocationCount(
    serverId: string,
    targetCount: number,
    apiKey: string,
    requiresConsecutivePorts?: boolean,
  ): Promise<AllocationAttributes[]> {
    if (requiresConsecutivePorts && targetCount >= 2) {
      return this.setConsecutiveAllocations(serverId, apiKey);
    }

    const currentAllocations = await this.listServerAllocations(
      serverId,
      apiKey,
    );
    const currentCount = currentAllocations.length;

    if (currentCount >= targetCount) {
      this.logger.debug(
        `Server ${serverId} already has ${currentCount} allocations (need ${targetCount}), keeping existing`,
        { ...this.base(), ptServerId: serverId, currentCount, targetCount },
      );
      return currentAllocations;
    }

    // Add allocations to reach target count
    const allocationsToAdd = targetCount - currentCount;

    for (let i = 0; i < allocationsToAdd; i++) {
      try {
        await this.assignAllocation(serverId, apiKey);
      } catch (error) {
        this.logger.error(
          `Failed to add allocation ${i + 1} of ${allocationsToAdd} to server ${serverId}`,
          {
            ...this.base(),
            ptServerId: serverId,
            allocationIndex: i + 1,
            allocationsToAdd,
            error,
          },
        );
        throw error;
      }
    }

    // Return updated allocations
    return this.listServerAllocations(serverId, apiKey);
  }

  private async updateServerEnvironmentVariable(
    serverId: string,
    envVarName: string,
    value: string | number,
    apiKey: string,
  ): Promise<void> {
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
        {
          ...this.base(),
          ptServerId: serverId,
          envVarName,
          status: response.status,
          error: errorData,
        },
      );
      return;
    }

    this.logger.log(
      `Updated environment variable ${envVarName} to ${value} for server ${serverId}`,
      { ...this.base(), ptServerId: serverId, envVarName, value },
    );
  }

  async correctPorts(
    ptServerId: string,
    gameSlug: string,
    user: User,
    maxRetries: number = 4,
  ): Promise<PortConfigurationResult> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.configureServerPorts(
          ptServerId,
          gameSlug,
          user.ptKey!,
        );

        return {
          ...result,
          attemptsMade: attempt,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        this.logger.warn(
          `Port configuration attempt ${attempt}/${maxRetries} failed for server ${ptServerId}: ${lastError.message}`,
          {
            ...this.base(),
            ptServerId,
            gameSlug,
            attempt,
            maxRetries,
            error: lastError,
          },
        );

        if (attempt < maxRetries) {
          const delayMs = Math.min(5000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s

          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    this.logger.error(
      `All ${maxRetries} port configuration attempts failed for server ${ptServerId}`,
      {
        ...this.base(),
        ptServerId,
        gameSlug,
        maxRetries,
        error: lastError,
      },
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
    gameSlug: string,
    apiKey: string,
  ): Promise<Omit<PortConfigurationResult, 'attemptsMade'>> {
    this.logger.debug(
      `Starting port configuration for server ${ptServerId}, game ${gameSlug}`,
      { ...this.base(), ptServerId, gameSlug },
    );

    const gameConfig = getGamePortConfig(gameSlug);

    if (!(gameSlug in GAME_PORT_CONFIG)) {
      this.logger.warn(
        `No port configuration found for game slug: ${gameSlug}, using default (1 allocation, no extra ports)`,
        { ...this.base(), ptServerId, gameSlug },
      );
    }

    this.logger.log(
      `Ensuring server has ${gameConfig.requiredAllocations} allocations`,
      {
        ...this.base(),
        ptServerId,
        gameSlug,
        requiredAllocations: gameConfig.requiredAllocations,
      },
    );

    // A game change or "fix ports" can need more ports than the server's limit allows
    // (e.g. Minecraft on a 1-port tier switched to Satisfactory).
    await this.ensureAllocationLimit(
      ptServerId,
      gameConfig.requiredAllocations,
    );

    const allocations = await this.setAllocationCount(
      ptServerId,
      gameConfig.requiredAllocations,
      apiKey,
      gameConfig.requiresConsecutivePorts,
    );

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
      if (gameConfig.requiresConsecutivePorts && primaryAllocation) {
        // The labelled secondary port must be the one right after the primary,
        // not one of the extra ports the tier allows.
        const nextPort = primaryAllocation.port + 1;
        secondaryAllocations.sort(
          (a, b) => Number(b.port === nextPort) - Number(a.port === nextPort),
        );
      }

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

    this.logger.log(
      `Port configuration completed for server ${ptServerId}. Allocations: ${allocations.length}, Ports configured: ${portsConfigured.length}`,
      {
        ...this.base(),
        ptServerId,
        gameSlug,
        allocations: allocations.length,
        portsConfigured,
      },
    );

    return {
      success: true,
      allocations: allocations.length,
      portsConfigured,
    };
  }
}
