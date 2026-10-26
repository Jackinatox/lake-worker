import { Injectable } from '@nestjs/common';
import {
  FactorioConfig,
  HytaleConfig,
  ModpackConfig,
  SatisfactoryConfig,
  ValheimConfig,
} from './GameConfig';

const FACTORIO_DEFAULTS = {
  version: 'latest',
  maxSlots: '20',
  saveName: 'gamesave',
  serverToken: 'undefined',
  serverName: 'Factorio Server',
  serverDescription: 'Factorio Server hosted by Scyed',
  serverUsername: 'unnamed',
  saveInterval: '10',
  saveSlots: '5',
  afkKick: '0',
  startup:
    'if [ ! -f "./saves/{{SAVE_NAME}}.zip" ]; then ./bin/x64/factorio --create ./saves/{{SAVE_NAME}}.zip --map-gen-settings data/map-gen-settings.json --map-settings data/map-settings.json; fi; ./bin/x64/factorio --port {{SERVER_PORT}} --server-settings data/server-settings.json --start-server saves/{{SAVE_NAME}}.zip',
} as const;

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

  /**
   * Modrinth Generic installer egg. The egg declares only two variables —
   * PROJECT_ID (required) and VERSION_ID (optional, defaults to "latest") — and
   * downloads/installs the pack itself, writing its own server.properties from
   * the pack's overrides. We therefore do NOT push gameSpecificConfig
   * (maxPlayers, difficulty, …) here — the pack's own config wins. The startup
   * command is the egg's own default; it must not reuse a flavor egg's startup.
   */
  modrinth(modpack: ModpackConfig): any {
    return {
      environment: {
        PROJECT_ID: modpack.projectId,
        VERSION_ID: modpack.versionId || 'latest',
      },
      // Verbatim default startup from the "Modrinth Generic" egg. Single-quoted
      // because it contains backticks (`cat .serverjar`) that must reach the
      // shell literally, not be evaluated by JS.
      startup:
        'java $([[ -f user_jvm_args.txt ]] && printf %s "@user_jvm_args.txt") -Xms128M -Xmx{{SERVER_MEMORY}}M -Dterminal.jline=false -Dterminal.ansi=true $([[ ! -f unix_args.txt ]] && printf %s "-jar `cat .serverjar`" || printf %s "@unix_args.txt")',
    };
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
  factorio(gameConfig: FactorioConfig): any {
    const factorioVersion =
      gameConfig.version === 'custom'
        ? gameConfig.customVersion?.trim() || FACTORIO_DEFAULTS.version
        : gameConfig.version;
    const enabledDLCs = new Set(gameConfig.enabledDLCs);
    const saveName = gameConfig.saveName.trim() || FACTORIO_DEFAULTS.saveName;
    const serverDescription =
      gameConfig.serverDescription.trim() ||
      FACTORIO_DEFAULTS.serverDescription;

    const startAndVars = {
      environment: {
        FACTORIO_VERSION: factorioVersion,
        MAX_SLOTS:
          gameConfig.maxSlots > 0
            ? gameConfig.maxSlots.toString()
            : FACTORIO_DEFAULTS.maxSlots,
        SAVE_NAME: saveName,
        SERVER_TOKEN: FACTORIO_DEFAULTS.serverToken,
        SERVER_NAME: FACTORIO_DEFAULTS.serverName,
        SERVER_DESC: serverDescription,
        SERVER_USERNAME: FACTORIO_DEFAULTS.serverUsername,
        SAVE_INTERVAL:
          gameConfig.autoSaveInterval > 0
            ? gameConfig.autoSaveInterval.toString()
            : FACTORIO_DEFAULTS.saveInterval,
        SAVE_SLOTS:
          gameConfig.autoSaveSlots > 0
            ? gameConfig.autoSaveSlots.toString()
            : FACTORIO_DEFAULTS.saveSlots,
        // The current UI only exposes AFK kick as a toggle, while the egg expects minutes.
        AFK_KICK: gameConfig.afkKick ? '1' : FACTORIO_DEFAULTS.afkKick,
        ELEVATED_RAILS_ENABLED: enabledDLCs.has('elevated-rails') ? '1' : '0',
        QUALITY_ENABLED: enabledDLCs.has('quality') ? '1' : '0',
        SPACE_AGE_ENABLED: enabledDLCs.has('space-age') ? '1' : '0',
      },
      startup: FACTORIO_DEFAULTS.startup,
    };

    return startAndVars;
  }
  valheim(gameConfig: ValheimConfig): any {
    const sharedEnvironment = {
      SERVER_NAME: gameConfig.server_name,
      PASSWORD: gameConfig.password,
      WORLD: gameConfig.world_name,
      PUBLIC_SERVER: gameConfig.public_server ? '1' : '0',
      ENABLE_CROSSPLAY: gameConfig.enable_crossplay ? '1' : '0',
      AUTO_UPDATE: gameConfig.auto_update ? '1' : '0',
      BACKUP_COUNT: gameConfig.backup_count.toString(),
      BACKUP_INTERVAL: gameConfig.backup_interval.toString(),
      BACKUP_SHORTTIME: gameConfig.backup_shorttime.toString(),
      BACKUP_LONGTIME: gameConfig.backup_longtime.toString(),
      SRCDS_APPID: '896660',
      // Fixed/hidden — required by API even though non-editable
      LD_LIBRARY_PATH: './linux64',
      STOP: 'kill -2 $!; wait;',
      CONSOLE_FILTER:
        '/^\\(Filename:.*Line:[[:space:]]+[[:digit:]]+\\)$/d; /^([[:space:]]+)?$/d',
    };

    if (gameConfig.mode === 'modded') {
      return {
        environment: {
          ...sharedEnvironment,
          // TODO: replace MODPACK with the actual modded egg variable name + any other modded-specific vars
          MODPACK: gameConfig.modpack ?? '',
        },
        // TODO: replace with actual modded egg startup command
        startup: `MODDED_STARTUP_PLACEHOLDER`,
      };
    }

    return {
      environment: sharedEnvironment,
      startup: `./valheim_server.x86_64 -nographics -batchmode -name "{{SERVER_NAME}}" -port {{SERVER_PORT}} -world "{{WORLD}}" -password "{{PASSWORD}}" -public {{PUBLIC_SERVER}} -saveinterval {{BACKUP_INTERVAL}} -backups {{BACKUP_COUNT}} -backupshort {{BACKUP_SHORTTIME}} -backuplong {{BACKUP_LONGTIME}} $( [[ {{ENABLE_CROSSPLAY}} -eq 1 ]] && echo " -crossplay ") > >(sed -uE "{{CONSOLE_FILTER}}") & trap "{{STOP}}" 15; wait $!`,
    };
  }
}
