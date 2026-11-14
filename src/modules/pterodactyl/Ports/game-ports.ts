/**
 * Port layout each game needs. `requiredAllocations` includes the primary port.
 *
 * Shared by provisioning (to size the Pterodactyl allocation limit) and the port
 * service (to assign and label the ports).
 */
export interface GamePortConfig {
  requiredAllocations: number;
  requiresConsecutivePorts?: boolean;
  ports: ReadonlyArray<{
    envVar?: string;
    notes: string;
    isSecondary: boolean;
  }>;
}

export const DEFAULT_GAME_PORT_CONFIG: GamePortConfig = {
  requiredAllocations: 1,
  ports: [],
};

export const GAME_PORT_CONFIG: Readonly<Record<string, GamePortConfig>> = {
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

export function getGamePortConfig(gameSlug: string): GamePortConfig {
  return GAME_PORT_CONFIG[gameSlug] ?? DEFAULT_GAME_PORT_CONFIG;
}

/**
 * Pterodactyl allocation limit for a server: what the customer bought
 * (`GameServerOrder.allocations` = the resource tier's `ports`), but never less
 * than the game itself needs. Pterodactyl counts the primary port toward the
 * limit, so a 1-port tier on a 2-port game would otherwise fail port setup.
 */
export function allocationLimitFor(
  purchasedAllocations: number,
  gameSlug: string,
): number {
  return Math.max(
    purchasedAllocations,
    getGamePortConfig(gameSlug).requiredAllocations,
  );
}
