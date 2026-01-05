import { Injectable } from '@nestjs/common';
import {
  FabricEggId,
  ForgeEggId,
  NeoForgeEggId,
  PaperEggId,
  VanillaEggId,
} from 'src/lib/GlobalConsstants';
import { SatisfactoryConfig } from './GameConfig';

@Injectable()
export class EnvironmentService {
  minecraft(id: number, minecraftVersion: string): any {
    let startAndVars;

    switch (id) {
      case VanillaEggId:
        startAndVars = {
          environment: {
            MINECRAFT_VERSION: minecraftVersion,
            SERVER_JARFILE: 'server.jar',
          },
          startup:
            'java -Xms128M -XX:MaxRAMPercentage=90.0 -jar {{SERVER_JARFILE}}',
        };
        break;
      case ForgeEggId: // Forge
        startAndVars = {
          environment: {
            MINECRAFT_VERSION: minecraftVersion,
            SERVER_JARFILE: 'server.jar',
            BUILD_TYPE: 'latest',
          },
          startup:
            'java -Xms128M -XX:MaxRAMPercentage=90.0 -Dterminal.jline=false -Dterminal.ansi=true $( [[  ! -f unix_args.txt ]] && printf %s "-jar {{SERVER_JARFILE}}" || printf %s "@unix_args.txt" )',
        };
        break;
      case PaperEggId: // Paper
        startAndVars = {
          environment: {
            MINECRAFT_VERSION: minecraftVersion,
            SERVER_JARFILE: 'server.jar',
            BUILD_NUMBER: 'latest',
          },
          startup:
            'java -Xms128M -XX:MaxRAMPercentage=90.0 -Dterminal.jline=false -Dterminal.ansi=true -jar {{SERVER_JARFILE}}',
        };
        break;
      case FabricEggId: // Fabric
        startAndVars = {
          environment: {
            MINECRAFT_VERSION: minecraftVersion,
            SERVER_JARFILE: 'server.jar',
            FABRIC_VERSION: 'latest',
            LOADER_VERSION: 'latest',
          },
          startup:
            'java -Xms128M -XX:MaxRAMPercentage=90.0 -jar {{SERVER_JARFILE}}',
        };
        break;
      case NeoForgeEggId: // NeiForge
        startAndVars = {
          environment: {
            MINECRAFT_VERSION: minecraftVersion,
          },
          startup:
            'java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true @unix_args.txt',
        };
        break;
    }

    return startAndVars;
  }

  satifactory(gameConfig: SatisfactoryConfig): any {
    const startAndVars = {
      environment: {
        SRCDS_BETAID:
          gameConfig.version === 'experimental' ? 'experimental' : 'public',
        MAX_PLAYERS: gameConfig.max_players.toString(),
        NUM_AUTOSAVES: gameConfig.num_autosaves.toString(),
        UPLOAD_CRASH_REPORT: gameConfig.upload_crash_report.toString(),
        AUTOSAVE_INTERVAL: gameConfig.autosave_interval.toString(),
        // HardCoded:
        RELIABLE_PORT: '8888', // Will be replaced by correctPortsForGame
        SRCDS_APPID: '1690800',
      },
      startup:
        './Engine/Binaries/Linux/*-Linux-Shipping FactoryGame ?listen -Port={{SERVER_PORT}} -ReliablePort={{RELIABLE_PORT}}',
    };

    return startAndVars;
  }
}
