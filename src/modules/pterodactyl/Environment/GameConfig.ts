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
