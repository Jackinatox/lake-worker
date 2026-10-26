export interface SatisfactoryConfig {
  version: 'release' | 'experimental';
  max_players: number;
  num_autosaves: number;
  upload_crash_report: boolean;
  autosave_interval: number;
}

export interface HytaleConfig {
  auth_mode: 'authenticated' | 'offline';
  patchline: 'release' | 'pre-release';
  accept_early_plugins: boolean;
  allow_op: boolean;
  install_sourcequery_plugin: boolean;
  // Hidden from UI - set to defaults
  disable_sentry: boolean;
  use_aot_cache: boolean;
}

export interface MinecraftConfig {
  serverName: string;
  maxPlayers: number;
  viewDistance: number;
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard';
  enablePvp: boolean;
  enableNether: boolean;
  enableCommandBlocks: boolean;
  spawnProtection: number;
  allowFlight: boolean;
  flavor: string;
}

/**
 * Modpack descriptor set by `lake` on `gameConfig.modpack`. Present only when the
 * user picked a modpack; absent for flavor servers. `lake` has already resolved
 * `gameConfig.eggId` (the platform's installer egg) and `gameConfig.dockerImage`,
 * so the worker only needs the project/version to set the egg's variables.
 */
export interface ModpackConfig {
  /** Only 'modrinth' today; 'curseforge' added later as a second branch. */
  platform: 'modrinth';
  /** Modrinth project id (e.g. '1KVo5zza'). */
  projectId: string;
  /** Modrinth version id (e.g. 'g5RAIwpP'); 'latest' resolves to newest. */
  versionId: string;
  /** Display name, for logs/labels only. */
  name: string;
}

export type FactorioVersion = 'latest' | 'experimental' | 'custom';

export type FactorioDLC = 'elevated-rails' | 'quality' | 'space-age';

export interface FactorioConfig {
  version: FactorioVersion;
  customVersion?: string; // Only used when version is 'custom'
  maxSlots: number; // 1 to 32767 (smallint)
  saveName: string; // max 20 characters
  serverDescription: string; // max 100 characters
  autoSaveInterval: number; // 1-999 (1-3 digits)
  autoSaveSlots: number; // slider value
  afkKick: boolean;
  enabledDLCs: FactorioDLC[];
}

export interface ValheimBaseConfig {
  server_name: string;
  password: string;
  world_name: string;
  max_players: number;
  public_server: boolean;
  enable_crossplay: boolean;
  auto_update: boolean;
  backup_count: number;
  backup_interval: number;
  backup_shorttime: number;
  backup_longtime: number;
}

export interface ValheimVanillaConfig extends ValheimBaseConfig {
  mode: 'vanilla';
}

export interface ValheimModdedConfig extends ValheimBaseConfig {
  mode: 'modded';
  modpack?: string;
}

export type ValheimConfig = ValheimVanillaConfig | ValheimModdedConfig;
