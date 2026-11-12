import {
  BadRequestException,
  Body,
  Controller,
  InternalServerErrorException,
  Post,
} from '@nestjs/common';
import { LogContextService } from 'src/core/log-context.service';
import { LoggerService } from 'src/core/logger.service';
import { PrismaService } from 'src/core/prisma.service';
import { LogType } from 'src/generated/prisma/client';
import { ReassignPortsDTO } from 'src/modules/provisoning/dto/ReassignPortsDTO';
import { PterodactylPortService } from './port.service';

@Controller('ports')
export class PortsController {
  constructor(
    private readonly portService: PterodactylPortService,
    private readonly logger: LoggerService,
    private readonly logContext: LogContextService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async reassignPorts(@Body() reassignPorts: ReassignPortsDTO) {
    return this.logContext.run(
      { component: PortsController.name, type: LogType.GAME_SERVER },
      async () => {
        this.logger.log('Reassign ports requested', {
          ptServerId: reassignPorts.ptServerId,
        });

        const server = await this.prisma.gameServer.findFirst({
          where: { ptServerId: reassignPorts.ptServerId },
          include: { user: true, gameData: { select: { slug: true } } },
        });

        if (!server) {
          throw new BadRequestException(
            `No server found for ptServerId: ${reassignPorts.ptServerId}`,
          );
        }

        if (!server.gameData) {
          throw new BadRequestException(
            `No game data found for server: ${reassignPorts.ptServerId}`,
          );
        }

        // Server resolved: attribute the actual port work to it and its owner.
        return this.logContext.runForServer(
          { gameServerId: server.id, userId: server.userId },
          async () => {
            const result = await this.portService.correctPorts(
              reassignPorts.ptServerId,
              server.gameData.slug,
              server.user,
            );

            if (result.error) {
              this.logger.error('Port reassignment failed', {
                ptServerId: reassignPorts.ptServerId,
                error: result.error,
              });
              throw new InternalServerErrorException(result.error);
            }

            return { ...result };
          },
        );
      },
    );
  }
}
