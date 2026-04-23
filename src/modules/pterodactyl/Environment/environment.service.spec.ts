import { Test, TestingModule } from '@nestjs/testing';
import { EnvironmentService } from './environment.service';
import { FactorioConfig } from './GameConfig';

describe('EnvironmentService', () => {
  let service: EnvironmentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EnvironmentService],
    }).compile();

    service = module.get<EnvironmentService>(EnvironmentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should map factorio config to pterodactyl environment variables', () => {
    const config: FactorioConfig = {
      version: 'custom',
      customVersion: ' 1.1.110 ',
      maxSlots: 16,
      saveName: 'world',
      serverDescription: 'Factorio Server by Scyed',
      autoSaveInterval: 10,
      autoSaveSlots: 5,
      afkKick: false,
      enabledDLCs: ['elevated-rails', 'space-age'],
    };

    expect(service.factorio(config)).toEqual({
      environment: {
        FACTORIO_VERSION: '1.1.110',
        MAX_SLOTS: '16',
        SAVE_NAME: 'world',
        SERVER_TOKEN: 'undefined',
        SERVER_NAME: 'Factorio Server',
        SERVER_DESC: 'Factorio Server by Scyed',
        SERVER_USERNAME: 'unnamed',
        SAVE_INTERVAL: '10',
        SAVE_SLOTS: '5',
        AFK_KICK: '0',
        ELEVATED_RAILS_ENABLED: '1',
        QUALITY_ENABLED: '0',
        SPACE_AGE_ENABLED: '1',
      },
      startup:
        'if [ ! -f "./saves/{{SAVE_NAME}}.zip" ]; then ./bin/x64/factorio --create ./saves/{{SAVE_NAME}}.zip --map-gen-settings data/map-gen-settings.json --map-settings data/map-settings.json; fi; ./bin/x64/factorio --port {{SERVER_PORT}} --server-settings data/server-settings.json --start-server saves/{{SAVE_NAME}}.zip',
    });
  });

  it('should fall back to egg defaults for blank or zero-like factorio values', () => {
    const config = {
      version: 'custom',
      customVersion: '   ',
      maxSlots: 0,
      saveName: '   ',
      serverDescription: '   ',
      autoSaveInterval: 0,
      autoSaveSlots: 0,
      afkKick: false,
      enabledDLCs: [],
    } as FactorioConfig;

    expect(service.factorio(config)).toEqual({
      environment: {
        FACTORIO_VERSION: 'latest',
        MAX_SLOTS: '20',
        SAVE_NAME: 'gamesave',
        SERVER_TOKEN: 'undefined',
        SERVER_NAME: 'Factorio Server',
        SERVER_DESC: 'Factorio Server hosted by Scyed',
        SERVER_USERNAME: 'unnamed',
        SAVE_INTERVAL: '10',
        SAVE_SLOTS: '5',
        AFK_KICK: '0',
        ELEVATED_RAILS_ENABLED: '0',
        QUALITY_ENABLED: '0',
        SPACE_AGE_ENABLED: '0',
      },
      startup:
        'if [ ! -f "./saves/{{SAVE_NAME}}.zip" ]; then ./bin/x64/factorio --create ./saves/{{SAVE_NAME}}.zip --map-gen-settings data/map-gen-settings.json --map-settings data/map-settings.json; fi; ./bin/x64/factorio --port {{SERVER_PORT}} --server-settings data/server-settings.json --start-server saves/{{SAVE_NAME}}.zip',
    });
  });
});
