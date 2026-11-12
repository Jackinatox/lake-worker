import { Test, TestingModule } from '@nestjs/testing';
import { PterodactylPrismaService } from 'src/core/pterodactyl-prisma.service';
import { loggingTestProviders } from 'src/core/testing/logging.testing';
import { PterodactylPortService } from './port.service';

describe('PterodactylPortService', () => {
  let service: PterodactylPortService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PterodactylPortService,
        { provide: PterodactylPrismaService, useValue: {} },
        ...loggingTestProviders,
      ],
    }).compile();

    service = module.get<PterodactylPortService>(PterodactylPortService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
