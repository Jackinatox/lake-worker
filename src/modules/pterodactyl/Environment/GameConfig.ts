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
