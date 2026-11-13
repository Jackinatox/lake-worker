import { Injectable } from '@nestjs/common';
import { PterodactylPrismaService } from 'src/core/pterodactyl-prisma.service';

export type ServerWing = { id: number; name: string };

@Injectable()
export class WingsService {
  constructor(private readonly ptPrisma: PterodactylPrismaService) {}

  /**
   * Which wing each server runs on (a node in Pterodactyl terms), keyed by the Pterodactyl server id
   * (lake's `GameServer.ptAdminId`). Ids that do not exist in the panel are
   * simply missing from the result.
   */
  async wingsForServers(
    ptAdminIds: number[],
  ): Promise<Record<number, ServerWing>> {
    const servers = await this.ptPrisma.servers.findMany({
      where: { id: { in: [...new Set(ptAdminIds)] } },
      select: { id: true, nodes: { select: { id: true, name: true } } },
    });

    const result: Record<number, ServerWing> = {};
    for (const server of servers) {
      result[server.id] = { id: server.nodes.id, name: server.nodes.name };
    }
    return result;
  }
}
