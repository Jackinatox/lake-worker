import { Test, TestingModule } from '@nestjs/testing';
import { loggingTestProviders } from 'src/core/testing/logging.testing';
import { InstallationService } from './installation.service';

describe('InstallationService', () => {
  let service: InstallationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InstallationService, ...loggingTestProviders],
    }).compile();

    service = module.get<InstallationService>(InstallationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
