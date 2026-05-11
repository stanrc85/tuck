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
    mode: providerModeSchema.default('local').describe('Provider'),
    url: z
      .string()
      .optional()
      .describe('Custom git URL (for `custom` mode, or manual override)'),
    providerUrl: z
      .string()
      .optional()
      .describe('Provider instance URL (e.g. self-hosted GitLab)'),
    username: z.string().optional().describe('Cached username from the provider'),
    repoName: z.string().optional().describe('Repo name without owner'),
  })
  .default({ mode: 'local' });

export const categoryConfigSchema = z.object({
  patterns: z.array(z.string()),
  icon: z.string().optional(),
});

export const tuckConfigSchema = z.object({
  repository: z
    .object({
      defaultBranch: z
        .string()
        .default('main')
        .describe('Default git branch for the `~/.tuck/` repo'),
      autoCommit: z
        .boolean()
        .default(true)
        .describe('Whether `tuck sync` auto-commits detected changes'),
      autoPush: z
        .boolean()
        .default(false)
        .describe('Whether `tuck sync` auto-pushes after committing'),
    })
    .partial()
    .default({}),

  files: z
    .object({
      strategy: fileStrategySchema
        .default('copy')
        .describe('How tracked files are mirrored. See [File strategies](#file-strategies).'),
      backupOnRestore: z
        .boolean()
        .default(true)
        .describe(
          'Snapshot tracked files before `tuck restore` / `tuck apply` overwrites them. Strongly recommended.'
        ),
    })
    .partial()
    .default({}),

  categories: z
    .record(categoryConfigSchema)
    .optional()
    .default({})
    .describe(
      'Custom categories layered on top of the built-in set (`shell`, `git`, `editors`, `terminal`, `ssh`, `misc`).'
    ),

  ignore: z
    .array(z.string())
    .optional()
    .default([])
    .describe('Paths that `tuck scan` and `tuck add` skip automatically.'),

  defaultGroups: z
    .array(z.string())
    .optional()
    .default([])
    .describe(
      'Host-groups applied to newly tracked files when `-g`/`--group` is not specified. Set by `tuck migrate` and editable via `tuck config`. Usually lives in `.tuckrc.local.json` (per-host).'
    ),

  readOnlyGroups: z
    .array(z.string())
    .optional()
    .default([])
    .describe(
      'Host-groups treated as read-only (consumer) roles. Any host whose `defaultGroups` intersects this list refuses write commands (`sync`, `push`, `add`, `remove`) with `HostReadOnlyError`. Override per invocation with `--force-write` or `TUCK_FORCE_WRITE=true`.'
    ),

  hooks: z
    .object({
      preSync: z.string().optional().describe('Runs before `tuck sync`'),
      postSync: z.string().optional().describe('Runs after `tuck sync`'),
      preRestore: z.string().optional().describe('Runs before `tuck restore`'),
      postRestore: z.string().optional().describe('Runs after `tuck restore`'),
    })
    .partial()
    .default({})
    .describe(
      'Shell commands run around sync/restore. Each runs in the `~/.tuck/` cwd. See [Hooks](./Hooks).'
    ),

  validation: z
    .object({
      preSync: z
        .boolean()
        .default(false)
        .describe(
          'When `true`, run `tuck validate` against every tracked file at the start of `tuck sync` (warn-only — does not block).'
        ),
    })
    .partial()
    .default({})
    .describe(
      'Validation policy. Opt-in only; default keeps `tuck sync` paying zero validation cost.'
    ),

  encryption: z
    .object({
      enabled: z.boolean().default(false).describe('Master switch for encryption features'),
      backupsEnabled: z.boolean().default(false).describe('Enable encryption for backups'),
      gpgKey: z.string().optional().describe('GPG key identifier (must be in your keyring)'),
      files: z.array(z.string()).default([]).describe('Tracked files to encrypt'),
      _verificationSalt: z.string().optional(),
      _verificationHash: z.string().optional(),
    })
    .partial()
    .default({})
    .describe(
      'Optional GPG-based encryption for specific tracked files and/or backup snapshots. Defaults off.'
    ),

  ui: z
    .object({
      colors: z.boolean().default(true).describe('ANSI colors in output'),
      emoji: z.boolean().default(true).describe('Unicode emoji / icons in prompts'),
      verbose: z.boolean().default(false).describe('Enable debug-level logging'),
    })
    .partial()
    .default({})
    .describe(
      'Terminal UX toggles. The `NO_COLOR=1` env var is also honored regardless of `colors`.'
    ),

  snapshots: z
    .object({
      maxCount: z
        .number()
        .int()
        .nonnegative()
        .default(50)
        .describe('Keep at most this many snapshots. `0` disables the count dimension.'),
      maxAgeDays: z
        .number()
        .int()
        .nonnegative()
        .default(30)
        .describe('Delete snapshots older than this. `0` disables the age dimension.'),
    })
    .partial()
    .default({})
    .describe(
      'Retention policy for Time Machine snapshots. Pruning runs after each new snapshot. Both `0` = no pruning.'
    ),

  security: securityConfigSchema.describe(
    'Secret-scanning policy. Full reference in [Security & Secrets](./Security-and-Secrets).'
  ),

  remote: remoteConfigSchema.describe(
    'Provider configuration. See [Git Providers](./Git-Providers) for per-provider setup.'
  ),
});

export type TuckConfigInput = z.input<typeof tuckConfigSchema>;
/**
 * Merged config returned by `loadConfig` — shared schema output plus
 * local-only overlay fields (see `tuckLocalConfigSchema`). The shared
 * Zod schema deliberately does NOT include local-only fields, so
 * shared-config parsing rejects them; the type intersection here just
 * lets callers read the merged field after the loader layers it in.
 */
export type TuckConfigOutput = z.output<typeof tuckConfigSchema> & {
  /** Only set when `.tuckrc.local.json` opts in. See tuckLocalConfigSchema. */
  trustHooks?: boolean;
};
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
    defaultGroups: z
      .array(z.string())
      .optional()
      .describe('Per-host group tags auto-applied when `-g` is omitted'),
    hooks: z
      .object({
        preSync: z.string().optional(),
        postSync: z.string().optional(),
        preRestore: z.string().optional(),
        postRestore: z.string().optional(),
      })
      .partial()
      .strict()
      .optional()
      .describe(
        'Per-host hook overrides. Each hook type merged independently with the shared hook of the same name.'
      ),
    trustHooks: z
      .boolean()
      .optional()
      .describe(
        'When `true`, this host trusts every configured hook and skips the per-execution confirmation prompt. Local-only by design — see [Why `trustHooks` is local-only](#why-trusthooks-is-local-only).'
      ),
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
  readOnlyGroups: [],
  hooks: {},
  validation: {
    preSync: false,
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
