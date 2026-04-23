export type FileStrategy = 'copy' | 'symlink';

/** Supported git provider modes */
export type ProviderMode = 'github' | 'gitlab' | 'local' | 'custom';

/** Remote/provider configuration */
export interface RemoteConfig {
  /** Provider mode */
  mode: ProviderMode;
  /** Custom remote URL (for custom mode) */
  url?: string;
  /** Provider instance URL (for self-hosted GitLab, etc.) */
  providerUrl?: string;
  /** Cached username from provider */
  username?: string;
  /** Repository name */
  repoName?: string;
}

export interface TuckConfig {
  repository: {
    path: string;
    defaultBranch: string;
    autoCommit: boolean;
    autoPush: boolean;
  };
  files: {
    strategy: FileStrategy;
    backupOnRestore: boolean;
  };
  categories: Record<
    string,
    {
      patterns: string[];
      icon?: string;
    }
  >;
  ignore: string[];
  /** Default host-groups applied when -g/--group is omitted. */
  defaultGroups?: string[];
  hooks: {
    preSync?: string;
    postSync?: string;
    preRestore?: string;
    postRestore?: string;
  };
  encryption: {
    enabled: boolean;
    gpgKey?: string;
    files: string[];
  };
  ui: {
    colors: boolean;
    emoji: boolean;
    verbose: boolean;
  };
  /** Retention policy for Time Machine snapshots. */
  snapshots?: {
    /** Keep at most this many snapshots. */
    maxCount?: number;
    /** Delete snapshots older than this many days. */
    maxAgeDays?: number;
  };
  /** Remote/provider configuration */
  remote?: RemoteConfig;
}

export interface TrackedFile {
  source: string;
  destination: string;
  category: string;
  strategy: FileStrategy;
  encrypted: boolean;
  permissions?: string;
  added: string;
  modified: string;
  checksum: string;
  /** Named host-groups this file belongs to. Post-migration invariant: length >= 1. */
  groups: string[];
}

export interface TuckManifest {
  version: string;
  created: string;
  updated: string;
  machine?: string;
  files: Record<string, TrackedFile>;
}

export interface InitOptions {
  dir?: string;
  remote?: string;
  bare?: boolean;
  from?: string;
  /**
   * When true (default), `tuck init` reads `/etc/os-release` on Linux and
   * offers to seed `defaultGroups` with the detected distro ID (kali,
   * ubuntu, debian, arch, fedora, …). Pass `--no-detect-os` to skip the
   * probe. Non-Linux hosts always skip.
   */
  detectOs?: boolean;
}

export interface AddOptions {
  category?: string;
  name?: string;
  symlink?: boolean;
  force?: boolean; // Skip secret scanning (secrets will not be detected)
  /** Host-groups to assign. Repeatable via `-g name1 -g name2`. */
  group?: string[];
  /** Override the readOnlyGroups guardrail for this invocation. */
  forceWrite?: boolean;
  // TODO: Encryption and templating are planned for a future version
  // encrypt?: boolean;
  // template?: boolean;
}

export interface RemoveOptions {
  delete?: boolean;
  keepOriginal?: boolean;
  /** Untrack + delete + commit + push in one step. Implies `delete`. */
  push?: boolean;
  /** Override the auto-generated commit message used with --push. */
  message?: string;
  /** Override the readOnlyGroups guardrail for this invocation. */
  forceWrite?: boolean;
}

export interface SyncOptions {
  message?: string;
  // TODO: --all and --amend are planned for a future version
  // all?: boolean;
  // amend?: boolean;
  noCommit?: boolean;
  push?: boolean; // Commander converts --no-push to push: false
  pull?: boolean; // Commander converts --no-pull to pull: false
  scan?: boolean; // Commander converts --no-scan to scan: false
  noHooks?: boolean;
  trustHooks?: boolean;
  force?: boolean; // Skip secret scanning
  /** Filter files by host-group. Repeatable. Falls back to config.defaultGroups when omitted. */
  group?: string[];
  /** Preview which tracked files would be synced, then exit. No writes, no commit, no push. */
  list?: boolean;
  /** Override the readOnlyGroups guardrail for this invocation. */
  forceWrite?: boolean;
}

export interface PushOptions {
  force?: boolean;
  setUpstream?: string;
  /** Override the readOnlyGroups guardrail for this invocation. */
  forceWrite?: boolean;
}

export interface PullOptions {
  rebase?: boolean;
  restore?: boolean;
  /**
   * `tuck pull --mirror` — `git fetch && git reset --hard @{u}`. Treats the
   * repo as a read-only mirror; destroys local commits. Required pair
   * with `allowDivergent` when the host has unpushed commits.
   */
  mirror?: boolean;
  /**
   * Bypass the divergence safety gate (ahead>0 + behind>0, or mirror mode
   * with ahead>0). Without this, the pull fails fast with a three-suggestion
   * error so the user can make an informed choice.
   */
  allowDivergent?: boolean;
}

export interface RestoreOptions {
  all?: boolean;
  symlink?: boolean;
  backup?: boolean;
  dryRun?: boolean;
  noHooks?: boolean;
  trustHooks?: boolean;
  noSecrets?: boolean;
  /** Filter files by host-group. Repeatable. */
  group?: string[];
  /**
   * Tri-state gate on the restore-tail "missing tool deps" prompt:
   *   `true`      — auto-install without prompting (also the non-TTY
   *                 opt-in, since prompting isn't possible there).
   *   `false`     — skip install and log an advisory.
   *   `undefined` — interactive TTY prompts y/n (default Yes); non-TTY
   *                 falls back to advisory (auto-install without
   *                 explicit opt-in would be surprising).
   */
  installDeps?: boolean;
  /**
   * When true, after restore completes run `tuck bootstrap --bundle <g>`
   * for each `-g` value (or `defaultGroups` fallback) whose name matches
   * a bundle in `bootstrap.toml`. Groups without a matching bundle
   * soft-skip with an info log. Paired with `yes` for the non-interactive
   * fresh-host flow (`tuck restore --bootstrap -g kubuntu -y`).
   */
  bootstrap?: boolean;
  /**
   * Forwarded to `runBootstrap` when `bootstrap` is true: skips bootstrap
   * confirmations and enables the sudo pre-check. Does not affect restore
   * hook confirmations — use `trustHooks` for those.
   */
  yes?: boolean;
}

export interface StatusOptions {
  short?: boolean;
  json?: boolean;
}

export interface ListOptions {
  category?: string;
  paths?: boolean;
  json?: boolean;
  /** Filter files by host-group. Repeatable. */
  group?: string[];
}

export interface DiffOptions {
  staged?: boolean;
  stat?: boolean;
  category?: string;
  nameOnly?: boolean;
  exitCode?: boolean;
  /** Two-column layout; auto-falls back to unified on narrow terminals. */
  sideBySide?: boolean;
  /** Filter by host-group. Repeatable. Falls back to config.defaultGroups when omitted. */
  group?: string[];
}

export interface DoctorOptions {
  json?: boolean;
  strict?: boolean;
  category?: 'env' | 'repo' | 'manifest' | 'security' | 'hooks';
}

export interface FileChange {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
  source: string;
  destination?: string;
}
