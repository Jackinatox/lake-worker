import { Injectable, Logger } from '@nestjs/common';
import { Builder, NewServerOptions, Server } from '@avionrx/pterodactyl-js';
import { withRetry } from 'src/lib/general/withRetry';

/**
 * Handles communication with the Pterodactyl API.
 * Single Responsibility: Only handles Pterodactyl API operations.
 */
@Injectable()
export class PterodactylClientService {
  private readonly logger = new Logger(PterodactylClientService.name);
  private readonly client = new Builder()
    .setURL(process.env.PTERODACTYL_URL!)
    .setAPIKey(process.env.PTERODACTYL_API_KEY!)
    .asAdmin();

  async createServer(options: NewServerOptions): Promise<Server> {
    return this.client.createServer({ ...options, skipScripts: true });
  }

  async createServerWithRetry(
    options: NewServerOptions,
    maxAttempts = 1,
    delayMs = 5000,
  ): Promise<Server> {
    return withRetry(() => this.createServer(options), {
      maxAttempts,
      delayMs,
    });
  }
}
