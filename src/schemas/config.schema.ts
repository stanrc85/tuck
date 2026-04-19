import { z } from 'zod';
import { securityConfigSchema } from './secrets.schema.js';

export const fileStrategySchema = z.enum(['copy', 'symlink']);

// ============================================================================
// Remote/Provider Configuration
// ============================================================================

/** Supported git provider modes */
export const providerModeSchema = z.enum(['github', 'gitlab', 'local', 'custom']);

/** Remote configuration schema */
export const remoteConfigSchema = z
  .object({
    /** Provider mode (github, gitlab, local, custom) */
    mode: providerModeSchema.default('local'),
    /** Custom remote URL (for custom mode or manual override) */
    url: z.string().optional(),
    /** Provider instance URL (for self-hosted GitLab, etc.) */
    providerUrl: z.string().optional(),
    /** Cached username from provider */
    username: z.string().optional(),
    /** Repository name (without owner) */
    repoName: z.string().optional(),
  })
  .default({ mode: 'local' });

export const categoryConfigSchema = z.object({
  patterns: z.array(z.string()),
  icon: z.string().optional(),
});

export const tuckConfigSchema = z.object({
  repository: z
    .object({
      path: z.string(),
      defaultBranch: z.string().default('main'),
      autoCommit: z.boolean().default(true),
      autoPush: z.boolean().default(false),
    })
    .partial()
    .default({}),

  files: z
    .object({
      strategy: fileStrategySchema.default('copy'),
      backupOnRestore: z.boolean().default(true),
      backupDir: z.string().optional(),
    })
    .partial()
    .default({}),

  categories: z.record(categoryConfigSchema).optional().default({}),

  ignore: z.array(z.string()).optional().default([]),

  /**
   * Default host-groups applied to newly tracked files when `-g/--group` is
   * not specified. Set by `tuck migrate` and editable via `tuck config`.
   * Empty array means every `tuck add` must specify `-g` explicitly.
   */
  defaultGroups: z.array(z.string()).optional().default([]),

  hooks: z
    .object({
      preSync: z.string().optional(),
      postSync: z.string().optional(),
      preRestore: z.string().optional(),
      postRestore: z.string().optional(),
    })
    .partial()
    .default({}),

  templates: z
    .object({
      enabled: z.boolean().default(false),
      variables: z.record(z.string()).default({}),
    })
    .partial()
    .default({}),

  encryption: z
    .object({
      /** Master switch for encryption features */
      enabled: z.boolean().default(false),
      /** Enable encryption for backups */
      backupsEnabled: z.boolean().default(false),
      /** GPG key for encryption (optional) */
      gpgKey: z.string().optional(),
      /** Files to encrypt */
      files: z.array(z.string()).default([]),
      /** Internal: Salt for password verification (hex encoded) */
      _verificationSalt: z.string().optional(),
      /** Internal: Hash for password verification */
      _verificationHash: z.string().optional(),
    })
    .partial()
    .default({}),

  ui: z
    .object({
      colors: z.boolean().default(true),
      emoji: z.boolean().default(true),
      verbose: z.boolean().default(false),
    })
    .partial()
    .default({}),

  /**
   * Retention policy for Time Machine snapshots (created by apply, restore,
   * sync, remove --delete, clean). Pruning runs after each new snapshot.
   * Set a value to `0` or omit to disable that dimension.
   */
  snapshots: z
    .object({
      /** Keep at most this many snapshots. Default: 50. */
      maxCount: z.number().int().nonnegative().default(50),
      /** Delete snapshots older than this many days. Default: 30. */
      maxAgeDays: z.number().int().nonnegative().default(30),
    })
    .partial()
    .default({}),

  security: securityConfigSchema,

  /** Remote/provider configuration */
  remote: remoteConfigSchema,
});

export type TuckConfigInput = z.input<typeof tuckConfigSchema>;
export type TuckConfigOutput = z.output<typeof tuckConfigSchema>;
export type ProviderMode = z.infer<typeof providerModeSchema>;
export type RemoteConfigOutput = z.output<typeof remoteConfigSchema>;

/**
 * Schema for `.tuckrc.local.json`, the host-specific override file that
 * layers on top of the shared `.tuckrc.json`. Only host-specific fields are
 * permitted here; `.strict()` guards against silently applying shared-only
 * fields from the wrong file.
 *
 * Expand deliberately when adding new per-host fields — resist widening this
 * to match `tuckConfigSchema` wholesale, which would reintroduce the
 * "committed config leaks across hosts" problem this file exists to fix.
 */
export const tuckLocalConfigSchema = z
  .object({
    defaultGroups: z.array(z.string()).optional(),
  })
  .strict();

export type TuckLocalConfigInput = z.input<typeof tuckLocalConfigSchema>;
export type TuckLocalConfigOutput = z.output<typeof tuckLocalConfigSchema>;

export const defaultConfig: TuckConfigOutput = {
  repository: {
    defaultBranch: 'main',
    autoCommit: true,
    autoPush: false,
  },
  files: {
    strategy: 'copy',
    backupOnRestore: true,
  },
  categories: {},
  ignore: [],
  defaultGroups: [],
  hooks: {},
  templates: {
    enabled: false,
    variables: {},
  },
  encryption: {
    enabled: false,
    backupsEnabled: false,
    files: [],
  },
  ui: {
    colors: true,
    emoji: true,
    verbose: false,
  },
  snapshots: {
    maxCount: 50,
    maxAgeDays: 30,
  },
  security: {
    scanSecrets: true,
    blockOnSecrets: true,
    minSeverity: 'high',
    scanner: 'builtin',
    customPatterns: [],
    excludePatterns: [],
    excludeFiles: [],
    maxFileSize: 10 * 1024 * 1024,
    secretBackend: 'local',
    cacheSecrets: true,
    secretMappings: 'secrets.mappings.json',
  },
  remote: {
    mode: 'local',
  },
};
