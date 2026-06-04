import { Injectable } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/pterodactyl/client';

@Injectable()
export class PterodactylPrismaService extends PrismaClient {
  constructor() {
    const adapter = new PrismaMariaDb(process.env.PTERODACTYL_DATABASE_URL!);
    super({ adapter });
  }
}
