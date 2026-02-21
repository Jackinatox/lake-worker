import {
  BadRequestException,
  Body,
  Controller,
  InternalServerErrorException,
  Post,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { LoggerService } from 'src/core/logger.service';
import { PrismaService } from 'src/core/prisma.service';
import { ReassignPortsDTO } from 'src/modules/provisoning/dto/ReassignPortsDTO';
import { PterodactylPortService } from './port.service';

@Controller('ports')
export class PortsController {
  private readonly tracer = trace.getTracer('PortsController', '1.0.0');

  constructor(
    private readonly portService: PterodactylPortService,
    private readonly logger: LoggerService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async reassignPorts(@Body() reassignPorts: ReassignPortsDTO) {
    return await this.tracer.startActiveSpan('correctPorts', async (span) => {
      this.logger.log('Reassign ports requested', {
        serverId: reassignPorts.serverId,
      });

      const server = await this.prisma.gameServer.findFirst({
        where: { ptServerId: reassignPorts.serverId },
        include: { user: true },
      });

      if (!server) {
        throw new BadRequestException(
          `No server found for ptServerId: ${reassignPorts.serverId}`,
        );
      }

      const result = await this.portService.correctPorts(
        reassignPorts.serverId,
        server.gameDataId,
        server.user,
      );

      if (result.error) {
        this.logger.error('Port reassignment failed', {
          serverId: reassignPorts.serverId,
          error: result.error,
        });
        span.recordException(result.error);
        throw new InternalServerErrorException(result.error);
      }

      return { ...result };
    });
  }
}
