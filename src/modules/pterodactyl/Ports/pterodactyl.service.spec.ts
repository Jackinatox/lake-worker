import { Test, TestingModule } from '@nestjs/testing';
import { PterodactylPortService } from './pterodactylPort.service';

describe('PterodactylService', () => {
  let service: PterodactylPortService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PterodactylPortService],
    }).compile();

    service = module.get<PterodactylPortService>(PterodactylPortService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
