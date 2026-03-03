import { Injectable } from '@nestjs/common';
import { HytaleConfig, SatisfactoryConfig } from './GameConfig';

@Injectable()
export class EnvironmentService {
  minecraft(flavorName: string, minecraftVersion: string): any {
    let startAndVars;

    switch (flavorName.toLowerCase()) {
      case 'vanilla':
        startAndVars = {
          environment: {
            MINECRAFT_VERSION: minecraftVersion,
            SERVER_JARFILE: 'server.jar',
          },
          startup:
            'java -Xms128M -XX:MaxRAMPercentage=90.0 -jar {{SERVER_JARFILE}}',
        };
        break;
      case 'forge':
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
      case 'paper':
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
      case 'fabric':
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
      case 'neoforge':
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

  satisfactory(gameConfig: SatisfactoryConfig): any {
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
  hytale(gameConfig: HytaleConfig): any {
    const startAndVars = {
      environment: {
        HYTALE_AUTH_MODE: gameConfig.auth_mode,
        HYTALE_PATCHLINE: gameConfig.patchline,
        HYTALE_ACCEPT_EARLY_PLUGINS: gameConfig.accept_early_plugins,
        HYTALE_ALLOW_OP: gameConfig.allow_op,
        INSTALL_SOURCEQUERY_PLUGIN: gameConfig.install_sourcequery_plugin,
        DISABLE_SENTRY: gameConfig.disable_sentry,
        USE_AOT_CACHE: gameConfig.use_aot_cache,
      },
      startup:
        'java $( ((USE_AOT_CACHE)) && printf %s "-XX:AOTCache=Server/HytaleServer.aot" ) -Xms128M $( ((SERVER_MEMORY)) && printf %s "-Xmx${SERVER_MEMORY}M" ) -jar Server/HytaleServer.jar $( ((HYTALE_ALLOW_OP)) && printf %s "--allow-op" ) $( ((HYTALE_ACCEPT_EARLY_PLUGINS)) && printf %s "--accept-early-plugins" ) $( ((DISABLE_SENTRY)) && printf %s "--disable-sentry" ) --auth-mode ${HYTALE_AUTH_MODE} --assets Assets.zip --bind 0.0.0.0:${SERVER_PORT}',
    };
    return startAndVars;
  }
}
