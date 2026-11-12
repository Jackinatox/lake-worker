import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/core/prisma.service';
import { loggingTestProviders } from 'src/core/testing/logging.testing';
import { PortsController } from './ports.controller';
import { PterodactylPortService } from './port.service';

describe('PortsController', () => {
  let controller: PortsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortsController],
      providers: [
        {
          provide: PterodactylPortService,
          useValue: { correctPorts: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: { gameServer: { findFirst: jest.fn() } },
        },
        ...loggingTestProviders,
      ],
    }).compile();

    controller = module.get<PortsController>(PortsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
