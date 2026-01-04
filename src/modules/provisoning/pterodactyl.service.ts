// Type for order with all relations
/**
 * Provision a game server on Pterodactyl.
 *
 * This function receives the full order with all related data.
 * Implement your Pterodactyl API calls here.
 *
 * @param order - The GameServerOrder with relations
 * @returns The server ID (UUID) from Pterodactyl
 *
 */

import { GameServerOrder } from 'src/generated/prisma/browser.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function provisionServer(order: GameServerOrder): Promise<string> {
  // TODO: Implement your Pterodactyl provisioning logic here

  throw new Error('provisionServer not implemented' + order.id);
}
