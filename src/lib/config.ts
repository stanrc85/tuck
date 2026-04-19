import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { cosmiconfig } from 'cosmiconfig';
import {
  tuckConfigSchema,
  tuckLocalConfigSchema,
  defaultConfig,
  type TuckConfigOutput,
  type TuckLocalConfigInput,
} from '../schemas/config.schema.js';
import { getConfigPath, getLocalConfigPath, pathExists, getTuckDir } from './paths.js';
import { ConfigError } from '../errors.js';
import { LOCAL_CONFIG_FILE } from '../constants.js';

let cachedConfig: TuckConfigOutput | null = null;
let cachedTuckDir: string | null = null;

/**
 * Load the host-local config override (`.tuckrc.local.json`). Returns an empty
 * object when the file doesn't exist — callers treat it as "no overrides."
 * Validates against the strict local schema; throws ConfigError on malformed
 * JSON or unknown fields (the schema is `.strict()` to prevent silently
 * applying shared-only fields from the wrong file).
 */
const loadLocalConfig = async (dir: string): Promise<Partial<TuckConfigOutput>> => {
  const localPath = getLocalConfigPath(dir);
  if (!(await pathExists(localPath))) {
    return {};
  }

  let rawLocal: unknown;
  try {
    const content = await readFile(localPath, 'utf-8');
    rawLocal = JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ConfigError(`${LOCAL_CONFIG_FILE} contains invalid JSON`);
    }
    throw new ConfigError(`Failed to read ${LOCAL_CONFIG_FILE}: ${error}`);
  }

  const localResult = tuckLocalConfigSchema.safeParse(rawLocal);
  if (!localResult.success) {
    throw new ConfigError(
      `Invalid ${LOCAL_CONFIG_FILE}: ${localResult.error.message}`
    );
  }
  return localResult.data;
};

export const loadConfig = async (tuckDir?: string): Promise<TuckConfigOutput> => {
  const dir = tuckDir || getTuckDir();

  // Return cached config if same directory
  if (cachedConfig && cachedTuckDir === dir) {
    return cachedConfig;
  }

  const configPath = getConfigPath(dir);
  const hasShared = await pathExists(configPath);

  // Local override always considered, even when shared file is absent.
  const localConfig = await loadLocalConfig(dir);

  if (!hasShared) {
    // No shared file: use defaults, then layer local overrides on top so a
    // fresh host still gets its `defaultGroups` / local hooks from
    // `.tuckrc.local.json`.
    cachedConfig = {
      ...defaultConfig,
      ...localConfig,
      repository: { ...defaultConfig.repository, path: dir },
      hooks: {
        ...defaultConfig.hooks,
        ...localConfig.hooks,
      },
    };
    cachedTuckDir = dir;
    return cachedConfig;
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    const rawConfig = JSON.parse(content);
    const result = tuckConfigSchema.safeParse(rawConfig);

    if (!result.success) {
      throw new ConfigError(`Invalid configuration: ${result.error.message}`);
    }

    // Precedence: defaults → shared (.tuckrc.json) → local (.tuckrc.local.json).
    // Flat fields in local replace the shared value entirely; nested `hooks`
    // is merged per-type (local preSync replaces shared preSync, but a hook
    // unset in local falls through to shared — so you can override one hook
    // per host without re-stating the others).
    cachedConfig = {
      ...defaultConfig,
      ...result.data,
      ...localConfig,
      repository: {
        ...defaultConfig.repository,
        ...result.data.repository,
        path: dir,
      },
      files: {
        ...defaultConfig.files,
        ...result.data.files,
      },
      hooks: {
        ...defaultConfig.hooks,
        ...result.data.hooks,
        ...localConfig.hooks,
      },
    };
    cachedTuckDir = dir;

    return cachedConfig;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new ConfigError('Configuration file contains invalid JSON');
    }
    throw new ConfigError(`Failed to load configuration: ${error}`);
  }
};

/**
 * Append `.tuckrc.local.json` to the tuck repo's `.gitignore` if missing.
 * Called whenever the local config is written so users who initialized tuck
 * before the local-config split automatically get their `.gitignore` updated.
 * Idempotent; no-op when the entry is already present.
 */
const ensureLocalConfigGitignored = async (tuckDir: string): Promise<void> => {
  const gitignorePath = join(tuckDir, '.gitignore');
  let existing = '';
  if (await pathExists(gitignorePath)) {
    try {
      existing = await readFile(gitignorePath, 'utf-8');
    } catch {
      return;
    }
  }

  const lines = existing.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(LOCAL_CONFIG_FILE)) {
    return;
  }

  const separator = existing.trim() ? '\n\n' : '';
  const updated =
    existing.trim() +
    `${separator}# Host-local tuck config (never commit)\n${LOCAL_CONFIG_FILE}\n`;

  try {
    await writeFile(gitignorePath, updated, 'utf-8');
  } catch {
    // Best effort — if we can't update .gitignore, don't block saving local config.
  }
};

/**
 * Write the host-local config override. Only fields allowed by
 * `tuckLocalConfigSchema` are accepted. Ensures the sibling `.gitignore`
 * includes the local filename so a subsequent `tuck sync` doesn't leak it
 * to the shared remote.
 */
export const saveLocalConfig = async (
  patch: TuckLocalConfigInput,
  tuckDir?: string
): Promise<void> => {
  const dir = tuckDir || getTuckDir();
  const localPath = getLocalConfigPath(dir);

  const existing = await loadLocalConfig(dir);
  const merged = { ...existing, ...patch };

  const result = tuckLocalConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ConfigError(
      `Invalid ${LOCAL_CONFIG_FILE} patch: ${result.error.message}`
    );
  }

  try {
    await writeFile(localPath, JSON.stringify(result.data, null, 2) + '\n', 'utf-8');
  } catch (error) {
    throw new ConfigError(`Failed to save ${LOCAL_CONFIG_FILE}: ${error}`);
  }

  await ensureLocalConfigGitignored(dir);

  // Invalidate cache so subsequent loadConfig() reflects the new local values.
  cachedConfig = null;
  cachedTuckDir = null;
};

export const saveConfig = async (
  config: Partial<TuckConfigOutput>,
  tuckDir?: string
): Promise<void> => {
  const dir = tuckDir || getTuckDir();
  const configPath = getConfigPath(dir);

  // Load existing config and merge
  const existing = await loadConfig(dir);
  const merged = {
    ...existing,
    ...config,
    repository: {
      ...existing.repository,
      ...config.repository,
    },
    files: {
      ...existing.files,
      ...config.files,
    },
    hooks: {
      ...existing.hooks,
      ...config.hooks,
    },
    encryption: {
      ...existing.encryption,
      ...config.encryption,
    },
    ui: {
      ...existing.ui,
      ...config.ui,
    },
  };

  // Validate before saving
  const result = tuckConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ConfigError(`Invalid configuration: ${result.error.message}`);
  }

  try {
    await writeFile(configPath, JSON.stringify(result.data, null, 2) + '\n', 'utf-8');
    // Update cache
    cachedConfig = result.data;
    cachedTuckDir = dir;
  } catch (error) {
    throw new ConfigError(`Failed to save configuration: ${error}`);
  }
};

export const getConfigValue = async <K extends keyof TuckConfigOutput>(
  key: K,
  tuckDir?: string
): Promise<TuckConfigOutput[K]> => {
  const config = await loadConfig(tuckDir);
  return config[key];
};

export const setConfigValue = async <K extends keyof TuckConfigOutput>(
  key: K,
  value: TuckConfigOutput[K],
  tuckDir?: string
): Promise<void> => {
  await saveConfig({ [key]: value } as Partial<TuckConfigOutput>, tuckDir);
};

export const resetConfig = async (tuckDir?: string): Promise<void> => {
  const dir = tuckDir || getTuckDir();
  const configPath = getConfigPath(dir);

  const resetTo = { ...defaultConfig, repository: { ...defaultConfig.repository, path: dir } };

  try {
    await writeFile(configPath, JSON.stringify(resetTo, null, 2) + '\n', 'utf-8');
    cachedConfig = resetTo;
    cachedTuckDir = dir;
  } catch (error) {
    throw new ConfigError(`Failed to reset configuration: ${error}`);
  }
};

export const clearConfigCache = (): void => {
  cachedConfig = null;
  cachedTuckDir = null;
};

export const findTuckDir = async (): Promise<string | null> => {
  // First check default location
  const defaultDir = getTuckDir();
  if (await pathExists(getConfigPath(defaultDir))) {
    return defaultDir;
  }

  // Try cosmiconfig to find config in current directory or parents
  const explorer = cosmiconfig('tuck', {
    searchPlaces: [
      '.tuckrc',
      '.tuckrc.json',
      '.tuckrc.yaml',
      '.tuckrc.yml',
      'tuck.config.js',
      'tuck.config.cjs',
    ],
  });

  try {
    const result = await explorer.search();
    if (result?.filepath) {
      // Return the directory containing the config file, not the file path itself
      return dirname(result.filepath);
    }
  } catch {
    // Ignore search errors
  }

  return null;
};
