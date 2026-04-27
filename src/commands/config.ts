import { Command } from 'commander';
import { spawn } from 'child_process';
import { writeFile } from 'fs/promises';
import { z } from 'zod';
import { prompts, colors as c } from '../ui/index.js';
import { getTuckDir, getConfigPath, getLocalConfigPath, collapsePath, pathExists } from '../lib/paths.js';
import { loadConfig, loadLocalConfig, saveConfig, saveLocalConfig, resetConfig } from '../lib/config.js';
import { loadManifest } from '../lib/manifest.js';
import { addRemote, removeRemote, hasRemote } from '../lib/git.js';
import { NotInitializedError, ConfigError } from '../errors.js';
import {
  tuckConfigSchema,
  tuckLocalConfigSchema,
  type TuckConfigOutput,
  type TuckLocalConfigInput,
} from '../schemas/config.schema.js';
import { setupProvider } from '../lib/providerSetup.js';
import { describeProviderConfig, getProvider } from '../lib/providers/index.js';

/**
 * Configuration key metadata for validation and help
 */
interface ConfigKeyInfo {
  path: string;
  type: 'boolean' | 'string' | 'enum';
  description: string;
  section: string;
  options?: string[]; // For enum types
}

const CONFIG_KEYS: ConfigKeyInfo[] = [
  // Repository settings
  {
    path: 'repository.defaultBranch',
    type: 'string',
    description: 'Default git branch name',
    section: 'repository',
  },
  {
    path: 'repository.autoCommit',
    type: 'boolean',
    description: 'Auto-commit changes on sync',
    section: 'repository',
  },
  {
    path: 'repository.autoPush',
    type: 'boolean',
    description: 'Auto-push after commit',
    section: 'repository',
  },
  // File settings
  {
    path: 'files.strategy',
    type: 'enum',
    description: 'File copy strategy',
    section: 'files',
    options: ['copy', 'symlink'],
  },
  {
    path: 'files.backupOnRestore',
    type: 'boolean',
    description: 'Create backups before restore',
    section: 'files',
  },
  // UI settings
  { path: 'ui.colors', type: 'boolean', description: 'Enable colored output', section: 'ui' },
  { path: 'ui.emoji', type: 'boolean', description: 'Enable emoji in output', section: 'ui' },
  { path: 'ui.verbose', type: 'boolean', description: 'Enable verbose logging', section: 'ui' },
  // Hook settings
  {
    path: 'hooks.preSync',
    type: 'string',
    description: 'Command to run before sync',
    section: 'hooks',
  },
  {
    path: 'hooks.postSync',
    type: 'string',
    description: 'Command to run after sync',
    section: 'hooks',
  },
  {
    path: 'hooks.preRestore',
    type: 'string',
    description: 'Command to run before restore',
    section: 'hooks',
  },
  {
    path: 'hooks.postRestore',
    type: 'string',
    description: 'Command to run after restore',
    section: 'hooks',
  },
  // Encryption settings
  {
    path: 'encryption.backupsEnabled',
    type: 'boolean',
    description: 'Enable backup encryption',
    section: 'encryption',
  },
];

const UNSUPPORTED_CONFIG_KEY_PREFIXES = [
  'encryption.enabled',
  'encryption.gpgKey',
  'encryption.files',
];

const BLOCKED_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const assertSafeConfigPath = (path: string): void => {
  for (const segment of path.split('.')) {
    if (BLOCKED_PATH_SEGMENTS.has(segment)) {
      throw new ConfigError(
        `Refusing to access reserved key '${segment}' in path '${path}'`
      );
    }
  }
};

const getKeyInfo = (path: string): ConfigKeyInfo | undefined => {
  return CONFIG_KEYS.find((k) => k.path === path);
};

const formatConfigValue = (value: unknown): string => {
  if (value === undefined || value === null) return c.dim('(not set)');
  if (typeof value === 'boolean') return value ? c.green('true') : c.yellow('false');
  if (Array.isArray(value)) return value.length ? c.cyan(value.join(', ')) : c.dim('[]');
  if (typeof value === 'object') return c.dim(JSON.stringify(value));
  return c.white(String(value));
};

const printConfig = (config: TuckConfigOutput): void => {
  console.log(JSON.stringify(config, null, 2));
};

const getNestedValue = (obj: Record<string, unknown>, path: string): unknown => {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
};

export const setNestedValue = (
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void => {
  // assertSafeConfigPath is the defense-in-depth runtime guard. The inline
  // string-equality checks below duplicate the intent at each usage site —
  // CodeQL's js/prototype-polluting-assignment dataflow can't follow values
  // through custom assertion helpers, so the inline form is what silences
  // the query. Don't collapse this into a helper: the visible inline check
  // is the load-bearing part for the static analyser.
  assertSafeConfigPath(path);
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new ConfigError(
        `Refusing to access reserved key '${key}' in path '${path}'`
      );
    }
    if (!Object.prototype.hasOwnProperty.call(current, key) || typeof current[key] !== 'object') {
      Object.defineProperty(current, key, {
        value: {},
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    current = current[key] as Record<string, unknown>;
  }

  const finalKey = keys[keys.length - 1];
  if (finalKey === '__proto__' || finalKey === 'constructor' || finalKey === 'prototype') {
    throw new ConfigError(
      `Refusing to access reserved key '${finalKey}' in path '${path}'`
    );
  }
  Object.defineProperty(current, finalKey, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
};

const unwrapSchema = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  let current = schema;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodNullable
  ) {
    current = current._def.innerType;
  }
  return current;
};

const resolveSchemaAtPath = (
  rootSchema: z.ZodTypeAny,
  path: string
): z.ZodTypeAny | null => {
  let current = unwrapSchema(rootSchema);
  for (const key of path.split('.')) {
    if (BLOCKED_PATH_SEGMENTS.has(key)) return null;
    if (!(current instanceof z.ZodObject)) return null;
    const shape = current.shape as Record<string, z.ZodTypeAny>;
    if (!Object.prototype.hasOwnProperty.call(shape, key)) return null;
    current = unwrapSchema(shape[key]);
  }
  return current;
};

export const parseValue = (value: string, key?: string): unknown => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = value;
  }

  // Auto-coerce scalar input into an array when the schema expects one —
  // `tuck config set defaultGroups kubuntu` or `...kubuntu,linux` should Just Work
  // without making users hand-craft JSON array literals.
  if (key && typeof parsed === 'string') {
    const fieldSchema = resolveSchemaAtPath(tuckConfigSchema, key);
    if (fieldSchema instanceof z.ZodArray) {
      return parsed
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  }

  return parsed;
};

const runConfigGet = async (key: string): Promise<void> => {
  const tuckDir = getTuckDir();
  const config = await loadConfig(tuckDir);

  const value = getNestedValue(config as unknown as Record<string, unknown>, key);

  if (value === undefined) {
    prompts.log.error(`Key not found: ${key}`);
    return;
  }

  if (typeof value === 'object') {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }
};

// Keys that belong in the per-host `.tuckrc.local.json` rather than the
// shared `.tuckrc.json`. Writing these to shared leaks host-specific state
// across every clone — e.g. `defaultGroups` set on the producer host would
// silently become the default for every consumer host that clones the repo.
const LOCAL_ONLY_KEYS = new Set(['defaultGroups']);

// Keys that MUST be written via `--local` (not silently auto-routed). These
// have security implications strong enough that we want users to opt in
// deliberately rather than land them in shared by accident — `trustHooks`
// disables the per-execution hook prompt, and silent auto-routing would let
// a typo (`tuck config set trustHooks true` meaning to scope it elsewhere)
// turn into a one-line foot-gun. Refusing without `--local` forces an
// acknowledgment that the field lives in the host-only file.
const REQUIRES_LOCAL_FLAG = new Set(['trustHooks']);

export interface ConfigSetOptions {
  /** Route the write to `.tuckrc.local.json`. Validates against the strict
   *  local schema; rejects shared-only keys like `repository.autoCommit`. */
  local?: boolean;
}

export const runConfigSet = async (
  key: string,
  value: string,
  options: ConfigSetOptions = {}
): Promise<void> => {
  const unsupportedPrefix = UNSUPPORTED_CONFIG_KEY_PREFIXES.find(
    (prefix) => key === prefix || key.startsWith(`${prefix}.`)
  );

  if (unsupportedPrefix) {
    throw new ConfigError(
      `Unsupported config key: ${key}. This setting is reserved but not wired yet.`
    );
  }

  // Security-sensitive keys must be set with explicit `--local` so that
  // writes can never land in shared `.tuckrc.json` (which travels with the
  // repo) by accident. The shared schema strips unknown keys silently
  // (default Zod behavior), so without this guard the write would appear
  // to succeed but evaporate.
  if (REQUIRES_LOCAL_FLAG.has(key) && !options.local) {
    throw new ConfigError(
      `Key '${key}' must be set with --local. ` +
      `It lives in .tuckrc.local.json (host-specific, never committed) by design — ` +
      `setting it in shared config would let a malicious commit bypass safety prompts ` +
      `for every downstream clone. Re-run with: tuck config set --local ${key} ${value}`
    );
  }

  const tuckDir = getTuckDir();
  const parsedValue = parseValue(value, key);

  if (options.local) {
    // Reject shared-only keys with a clear, actionable message before we hand
    // off to saveLocalConfig (which would also reject them, but with a less
    // useful Zod-internals string).
    const localFieldSchema = resolveSchemaAtPath(tuckLocalConfigSchema, key);
    if (!localFieldSchema) {
      throw new ConfigError(
        `Key '${key}' is not allowed in .tuckrc.local.json. ` +
        `The local schema accepts only host-specific fields ` +
        `(defaultGroups, hooks.{preSync,postSync,preRestore,postRestore}). ` +
        `Drop --local to write to the shared .tuckrc.json.`
      );
    }

    // Reconstruct the full local config and pass it through saveLocalConfig.
    // Going through setNestedValue on a deep-clone of existing values lets us
    // set a nested key (e.g. `hooks.preSync`) without dropping sibling nested
    // keys — saveLocalConfig only shallow-merges, so passing a partial
    // `{ hooks: { preSync } }` patch would clobber an existing `hooks.postSync`.
    const existing = await loadLocalConfig(tuckDir);
    const next: Record<string, unknown> = JSON.parse(JSON.stringify(existing));
    setNestedValue(next, key, parsedValue);
    await saveLocalConfig(next as TuckLocalConfigInput, tuckDir);
    prompts.log.success(`Set ${key} = ${JSON.stringify(parsedValue)} (.tuckrc.local.json)`);
    return;
  }

  if (LOCAL_ONLY_KEYS.has(key)) {
    await saveLocalConfig({ [key]: parsedValue } as never, tuckDir);
    prompts.log.success(`Set ${key} = ${JSON.stringify(parsedValue)} (.tuckrc.local.json)`);
    return;
  }

  const config = await loadConfig(tuckDir);
  const configObj = config as unknown as Record<string, unknown>;

  setNestedValue(configObj, key, parsedValue);

  await saveConfig(config, tuckDir);
  prompts.log.success(`Set ${key} = ${JSON.stringify(parsedValue)}`);
};

/**
 * Walk a dotted path and delete the leaf key from `obj`. Returns true if
 * a key was deleted, false if any segment along the path didn't exist
 * (no-op for `tuck config unset key-that-was-never-set`).
 *
 * Also prunes empty parent objects on the way back up, so unsetting
 * `hooks.preSync` from `{ hooks: { preSync: '...' } }` leaves `{}` rather
 * than `{ hooks: {} }`. Pruning stops at the first non-empty ancestor —
 * sibling keys are preserved.
 */
export const deleteNestedValue = (
  obj: Record<string, unknown>,
  path: string
): boolean => {
  assertSafeConfigPath(path);
  const keys = path.split('.');
  const trail: Array<{ parent: Record<string, unknown>; key: string }> = [];
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      return false;
    }
    const next = current[key];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      return false;
    }
    trail.push({ parent: current, key });
    current = next as Record<string, unknown>;
  }

  const finalKey = keys[keys.length - 1];
  if (!Object.prototype.hasOwnProperty.call(current, finalKey)) {
    return false;
  }
  delete current[finalKey];

  // Walk back up pruning empty intermediate objects we just emptied. Stop
  // at the first ancestor that still has siblings — that one stays intact.
  for (let i = trail.length - 1; i >= 0; i--) {
    const { parent, key } = trail[i];
    const child = parent[key] as Record<string, unknown>;
    if (Object.keys(child).length === 0) {
      delete parent[key];
    } else {
      break;
    }
  }

  return true;
};

export interface ConfigUnsetOptions {
  /** Remove from `.tuckrc.local.json`. Validates against the strict local
   *  schema — same gate as `tuck config set --local`. */
  local?: boolean;
}

export const runConfigUnset = async (
  key: string,
  options: ConfigUnsetOptions = {}
): Promise<void> => {
  const tuckDir = getTuckDir();

  if (options.local) {
    const localFieldSchema = resolveSchemaAtPath(tuckLocalConfigSchema, key);
    if (!localFieldSchema) {
      throw new ConfigError(
        `Key '${key}' is not allowed in .tuckrc.local.json. ` +
        `The local schema accepts only host-specific fields ` +
        `(defaultGroups, hooks.{preSync,postSync,preRestore,postRestore}, trustHooks). ` +
        `Drop --local to unset from the shared .tuckrc.json.`
      );
    }

    const existing = await loadLocalConfig(tuckDir);
    const next: Record<string, unknown> = JSON.parse(JSON.stringify(existing));
    const removed = deleteNestedValue(next, key);

    if (!removed) {
      prompts.log.info(`Key ${key} is not set in .tuckrc.local.json — nothing to do`);
      return;
    }

    // Replace mode: shallow merge would re-introduce the key we just deleted
    // (since `existing` still has it). saveLocalConfig's `replace: true`
    // skips the merge so the on-disk file matches `next` exactly.
    await saveLocalConfig(next as TuckLocalConfigInput, tuckDir, { replace: true });
    prompts.log.success(`Unset ${key} (.tuckrc.local.json)`);
    return;
  }

  const config = await loadConfig(tuckDir);
  const configObj = config as unknown as Record<string, unknown>;
  const removed = deleteNestedValue(configObj, key);

  if (!removed) {
    prompts.log.info(`Key ${key} is not set — nothing to do`);
    return;
  }

  await saveConfig(config, tuckDir);
  prompts.log.success(`Unset ${key}`);
};

const runConfigList = async (): Promise<void> => {
  const tuckDir = getTuckDir();
  const config = await loadConfig(tuckDir);

  // Pure JSON output for scriptability — no frame, no decoration.
  printConfig(config);
};

export interface ConfigEditOptions {
  /** Open `.tuckrc.local.json` instead of the shared `.tuckrc.json`. */
  local?: boolean;
}

const runConfigEdit = async (options: ConfigEditOptions = {}): Promise<void> => {
  const tuckDir = getTuckDir();

  let targetPath: string;
  if (options.local) {
    targetPath = getLocalConfigPath(tuckDir);

    // Bootstrap an empty file when the user opens --local for the first
    // time. Otherwise the editor opens a non-existent path, which on most
    // editors is fine but produces a "new file" indicator rather than an
    // editable starting state — confusing for users who expect the host's
    // current local config to appear.
    if (!(await pathExists(targetPath))) {
      await writeFile(targetPath, '{}\n', 'utf-8');
    }
  } else {
    targetPath = getConfigPath(tuckDir);
  }

  const editor = process.env.EDITOR || process.env.VISUAL || 'vim';

  prompts.log.info(`Opening ${collapsePath(targetPath)} in ${editor}...`);

  return new Promise((resolve, reject) => {
    const child = spawn(editor, [targetPath], {
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        prompts.log.success('Configuration updated');
        resolve();
      } else {
        reject(new ConfigError(`Editor exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(new ConfigError(`Failed to open editor: ${err.message}`));
    });
  });
};

const runConfigReset = async (): Promise<void> => {
  const tuckDir = getTuckDir();

  const confirm = await prompts.confirm(
    'Reset configuration to defaults? This cannot be undone.',
    false
  );

  if (!confirm) {
    prompts.cancel('Operation cancelled');
    return;
  }

  await resetConfig(tuckDir);
  prompts.log.success('Configuration reset to defaults');
};

/**
 * Show configuration in a visually organized way. Caller assumes a frame is open.
 */
const showConfigView = async (config: TuckConfigOutput): Promise<void> => {
  const configObj = config as unknown as Record<string, unknown>;

  if (config.remote) {
    prompts.log.message(
      [
        c.bold.cyan('~ Remote Provider'),
        `  ${describeProviderConfig(config.remote)}`,
      ].join('\n'),
    );
  }

  const sections = [
    { key: 'repository', title: 'Repository Settings', icon: '*' },
    { key: 'files', title: 'File Management', icon: '>' },
    { key: 'ui', title: 'User Interface', icon: '#' },
    { key: 'hooks', title: 'Hooks', icon: '!' },
    { key: 'encryption', title: 'Encryption', icon: '@' },
  ];

  for (const section of sections) {
    const sectionConfig = configObj[section.key];
    if (!sectionConfig || typeof sectionConfig !== 'object') continue;

    const sectionEntries = Object.entries(sectionConfig as Record<string, unknown>).filter(
      ([key]) => {
        if (section.key === 'encryption') {
          return getKeyInfo(`${section.key}.${key}`) !== undefined;
        }
        return true;
      }
    );

    const lines: string[] = [c.bold.cyan(`${section.icon} ${section.title}`)];
    for (const [key, value] of sectionEntries) {
      const keyInfo = getKeyInfo(`${section.key}.${key}`);
      const displayValue = formatConfigValue(value);
      const description = keyInfo?.description || '';

      lines.push(`  ${c.white(key)}: ${displayValue}`);
      if (description) {
        lines.push(c.dim(`    ${description}`));
      }
    }
    prompts.log.message(lines.join('\n'));
  }
};

/**
 * Run configuration wizard for guided setup
 */
const runConfigWizard = async (config: TuckConfigOutput, tuckDir: string): Promise<void> => {
  prompts.log.info("Let's configure tuck for your workflow");

  prompts.log.message(c.bold.cyan('* Repository Behavior'));
  const autoCommit = await prompts.confirm(
    'Auto-commit changes when running sync?',
    config.repository.autoCommit ?? true
  );
  const autoPush = await prompts.confirm(
    'Auto-push to remote after commit?',
    config.repository.autoPush ?? false
  );

  prompts.log.message(c.bold.cyan('> File Strategy'));
  const rawStrategy = await prompts.select('How should tuck manage files?', [
    { value: 'copy', label: 'Copy files', hint: 'Safe, independent copies' },
    { value: 'symlink', label: 'Symlink files', hint: 'Real-time updates, single source of truth' },
  ]);
  const strategy: 'copy' | 'symlink' =
    rawStrategy === 'copy' || rawStrategy === 'symlink'
      ? rawStrategy
      : (config.files.strategy ?? 'copy');

  const backupOnRestore = await prompts.confirm(
    'Create backups before restoring files?',
    config.files.backupOnRestore ?? true
  );

  prompts.log.message(c.bold.cyan('# User Interface'));
  const colors = await prompts.confirm('Enable colored output?', config.ui.colors ?? true);
  const emoji = await prompts.confirm('Enable emoji in output?', config.ui.emoji ?? true);
  const verbose = await prompts.confirm('Enable verbose logging?', config.ui.verbose ?? false);

  const updatedConfig: TuckConfigOutput = {
    ...config,
    repository: {
      ...config.repository,
      autoCommit,
      autoPush,
    },
    files: {
      ...config.files,
      strategy,
      backupOnRestore,
    },
    ui: {
      colors,
      emoji,
      verbose,
    },
  };

  await saveConfig(updatedConfig, tuckDir);

  prompts.log.success('Configuration updated!');
  prompts.log.message(c.dim("Run `tuck config` again to view or edit settings"));
};

/**
 * Interactive edit a single setting
 */
const editConfigInteractive = async (config: TuckConfigOutput, tuckDir: string): Promise<void> => {
  const configObj = config as unknown as Record<string, unknown>;

  // Create options for selection
  const options = CONFIG_KEYS.map((key) => {
    const currentValue = getNestedValue(configObj, key.path);
    return {
      value: key.path,
      label: key.path,
      hint: `${key.description} (current: ${formatConfigValue(currentValue)})`,
    };
  });

  const selectedKey = (await prompts.select('Select setting to edit:', options)) as string;
  const keyInfo = getKeyInfo(selectedKey);
  const currentValue = getNestedValue(configObj, selectedKey);

  if (!keyInfo) {
    prompts.log.error(`Unknown key: ${selectedKey}`);
    return;
  }

  let newValue: unknown;

  switch (keyInfo.type) {
    case 'boolean': {
      const defaultValue = typeof currentValue === 'boolean' ? currentValue : false;
      newValue = await prompts.confirm(keyInfo.description, defaultValue);
      break;
    }
    case 'enum':
      newValue = await prompts.select(
        `Select value for ${selectedKey}:`,
        (keyInfo.options || []).map((opt) => ({ value: opt, label: opt }))
      );
      break;
    case 'string':
      newValue = await prompts.text(`Enter value for ${selectedKey}:`, {
        defaultValue: (currentValue as string) || '',
        placeholder: '(leave empty to clear)',
      });
      break;
  }

  setNestedValue(configObj, selectedKey, newValue);
  await saveConfig(config, tuckDir);

  prompts.log.success(`Updated ${selectedKey} = ${formatConfigValue(newValue)}`);
};

/**
 * Run interactive config mode
 */
const runInteractiveConfig = async (): Promise<void> => {
  prompts.intro('tuck config');

  const tuckDir = getTuckDir();
  const config = await loadConfig(tuckDir);

  const action = (await prompts.select('What would you like to do?', [
    { value: 'view', label: 'View current configuration', hint: 'See all settings' },
    { value: 'edit', label: 'Edit a setting', hint: 'Modify a specific value' },
    { value: 'remote', label: 'Configure remote', hint: 'Set up GitHub, GitLab, or local mode' },
    { value: 'wizard', label: 'Run setup wizard', hint: 'Guided configuration' },
    { value: 'reset', label: 'Reset to defaults', hint: 'Restore default values' },
    { value: 'open', label: 'Open in editor', hint: `Edit with ${process.env.EDITOR || 'vim'}` },
  ])) as string;

  switch (action) {
    case 'view':
      await showConfigView(config);
      prompts.outro('Configuration shown');
      return;
    case 'edit':
      await editConfigInteractive(config, tuckDir);
      prompts.outro('Setting updated');
      return;
    case 'remote':
      await runConfigRemote();
      return; // runConfigRemote has its own outro
    case 'wizard':
      await runConfigWizard(config, tuckDir);
      prompts.outro('Configuration saved');
      return;
    case 'reset':
      await runConfigReset();
      prompts.outro('Done');
      return;
    case 'open':
      await runConfigEdit();
      prompts.outro('Done');
      return;
  }
};

/**
 * Run the remote provider configuration flow
 */
const runConfigRemote = async (): Promise<void> => {
  prompts.intro('tuck config remote');

  const tuckDir = getTuckDir();
  const config = await loadConfig(tuckDir);

  if (config.remote) {
    prompts.log.message(
      c.dim(`Current remote configuration:\n  ${describeProviderConfig(config.remote)}`),
    );
  }

  // Ask if they want to change
  const shouldChange = await prompts.confirm('Configure remote provider?', true);

  if (!shouldChange) {
    prompts.outro('No changes made');
    return;
  }

  // Run provider setup
  const result = await setupProvider();

  if (!result) {
    prompts.outro('Configuration cancelled');
    return;
  }

  // Update config with new remote settings
  const updatedConfig: TuckConfigOutput = {
    ...config,
    remote: result.config,
  };

  await saveConfig(updatedConfig, tuckDir);

  // If a remote URL was provided, update git remote
  if (result.remoteUrl) {
    try {
      // Check if origin already exists
      if (await hasRemote(tuckDir)) {
        // Remove existing remote
        await removeRemote(tuckDir, 'origin');
      }
      // Add new remote
      await addRemote(tuckDir, 'origin', result.remoteUrl);
      prompts.log.success('Git remote updated');
    } catch (error) {
      prompts.log.warning(
        `Could not update git remote: ${error instanceof Error ? error.message : String(error)}`
      );
      prompts.log.info(`Manually add remote: git remote add origin ${result.remoteUrl}`);
    }
  }

  // If switching to a provider that can create repos, offer to create one
  if (result.mode !== 'local' && result.mode !== 'custom' && !result.remoteUrl) {
    const shouldCreateRepo = await prompts.confirm(
      'Would you like to create a repository now?',
      true
    );

    if (shouldCreateRepo) {
      const provider = getProvider(result.mode, result.config);

      const repoName = await prompts.text('Repository name:', {
        defaultValue: 'dotfiles',
        placeholder: 'dotfiles',
        validate: (value) => {
          if (!value) return 'Repository name is required';
          // Ensure name starts and ends with alphanumeric
          if (!/^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(value)) {
            return 'Repository name must start and end with alphanumeric characters';
          }
          return undefined;
        },
      });

      const visibility = await prompts.select('Repository visibility:', [
        { value: 'private', label: 'Private (recommended)', hint: 'Only you can see it' },
        { value: 'public', label: 'Public', hint: 'Anyone can see it' },
      ]);

      try {
        const spinner = prompts.spinner();
        spinner.start('Creating repository...');

        const repo = await provider.createRepo({
          name: repoName,
          description: 'My dotfiles managed with tuck',
          isPrivate: visibility === 'private',
        });

        spinner.stop(`Repository created: ${repo.fullName}`);

        // Get preferred URL and add as remote
        const remoteUrl = await provider.getPreferredRepoUrl(repo);

        try {
          if (await hasRemote(tuckDir)) {
            await removeRemote(tuckDir, 'origin');
          }
          await addRemote(tuckDir, 'origin', remoteUrl);
          prompts.log.success('Remote configured');
        } catch (error) {
          prompts.log.warning(
            `Could not add remote: ${error instanceof Error ? error.message : String(error)}`
          );
        }

        // Update config with repo name
        updatedConfig.remote = {
          ...updatedConfig.remote,
          repoName,
        };
        await saveConfig(updatedConfig, tuckDir);
      } catch (error) {
        prompts.log.error(
          `Failed to create repository: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  prompts.log.success(`Remote configured: ${describeProviderConfig(result.config)}`);
  prompts.outro('Remote configured');
};

export const configCommand = new Command('config')
  .description('Manage tuck configuration')
  .action(async () => {
    const tuckDir = getTuckDir();
    try {
      await loadManifest(tuckDir);
    } catch {
      throw new NotInitializedError();
    }
    await runInteractiveConfig();
  })
  .addCommand(
    new Command('get')
      .description('Get a config value')
      .argument('<key>', 'Config key (e.g., "repository.autoCommit")')
      .action(async (key: string) => {
        const tuckDir = getTuckDir();
        try {
          await loadManifest(tuckDir);
        } catch {
          throw new NotInitializedError();
        }
        await runConfigGet(key);
      })
  )
  .addCommand(
    new Command('set')
      .description('Set a config value')
      .argument('<key>', 'Config key')
      .argument('<value>', 'Value to set (JSON or string)')
      .option(
        '--local',
        'Write to .tuckrc.local.json (host-specific) instead of the shared .tuckrc.json'
      )
      .action(async (key: string, value: string, opts: { local?: boolean }) => {
        const tuckDir = getTuckDir();
        try {
          await loadManifest(tuckDir);
        } catch {
          throw new NotInitializedError();
        }
        await runConfigSet(key, value, { local: opts.local });
      })
  )
  .addCommand(
    new Command('unset')
      .description('Remove a config value')
      .argument('<key>', 'Config key')
      .option(
        '--local',
        'Remove from .tuckrc.local.json (host-specific) instead of the shared .tuckrc.json'
      )
      .action(async (key: string, opts: { local?: boolean }) => {
        const tuckDir = getTuckDir();
        try {
          await loadManifest(tuckDir);
        } catch {
          throw new NotInitializedError();
        }
        await runConfigUnset(key, { local: opts.local });
      })
  )
  .addCommand(
    new Command('list').description('List all config').action(async () => {
      const tuckDir = getTuckDir();
      try {
        await loadManifest(tuckDir);
      } catch {
        throw new NotInitializedError();
      }
      await runConfigList();
    })
  )
  .addCommand(
    new Command('edit')
      .description('Open config in editor')
      .option(
        '--local',
        'Open .tuckrc.local.json (host-specific) instead of the shared .tuckrc.json'
      )
      .action(async (opts: { local?: boolean }) => {
        const tuckDir = getTuckDir();
        try {
          await loadManifest(tuckDir);
        } catch {
          throw new NotInitializedError();
        }
        await runConfigEdit({ local: opts.local });
      })
  )
  .addCommand(
    new Command('reset').description('Reset to defaults').action(async () => {
      const tuckDir = getTuckDir();
      try {
        await loadManifest(tuckDir);
      } catch {
        throw new NotInitializedError();
      }
      await runConfigReset();
    })
  )
  .addCommand(
    new Command('remote').description('Configure remote provider').action(async () => {
      const tuckDir = getTuckDir();
      try {
        await loadManifest(tuckDir);
      } catch {
        throw new NotInitializedError();
      }
      await runConfigRemote();
    })
  );
