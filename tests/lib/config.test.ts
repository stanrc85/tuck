/**
 * Config module unit tests
 *
 * Tests for configuration loading, saving, and caching.
 * Note: These tests use the actual file system mocking from setup.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { TEST_HOME, TEST_TUCK_DIR } from '../setup.js';

// Mock the config module dependencies
vi.mock('../../src/lib/paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/paths.js')>();
  return {
    ...original,
    getTuckDir: () => TEST_TUCK_DIR,
    getConfigPath: (dir: string) => join(dir, 'config.json'),
    getLocalConfigPath: (dir: string) => join(dir, 'config.local.json'),
    pathExists: async (path: string) => {
      try {
        vol.statSync(path);
        return true;
      } catch {
        return false;
      }
    },
  };
});

// Mock cosmiconfig to avoid filesystem issues
vi.mock('cosmiconfig', () => ({
  cosmiconfig: () => ({
    search: async () => null,
  }),
}));

// Import after mocking
import { clearConfigCache, loadConfig, saveLocalConfig } from '../../src/lib/config.js';
import { defaultConfig } from '../../src/schemas/config.schema.js';
import { ConfigError } from '../../src/errors.js';

describe('config', () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
    // Clear cache before each test
    clearConfigCache();
    vi.resetModules();
  });

  afterEach(() => {
    vol.reset();
    clearConfigCache();
  });

  // ============================================================================
  // Default Config Tests
  // ============================================================================

  describe('defaultConfig', () => {
    it('should have expected default values', () => {
      expect(defaultConfig.repository.defaultBranch).toBe('main');
      expect(defaultConfig.repository.autoCommit).toBe(true);
      expect(defaultConfig.repository.autoPush).toBe(false);
    });

    it('should have default files config', () => {
      expect(defaultConfig.files.strategy).toBe('copy');
      expect(defaultConfig.files.backupOnRestore).toBe(true);
    });

    it('should have empty hooks by default', () => {
      expect(defaultConfig.hooks).toBeDefined();
      expect(defaultConfig.hooks.preSync).toBeUndefined();
      expect(defaultConfig.hooks.postSync).toBeUndefined();
    });

    it('should have security defaults', () => {
      expect(defaultConfig.security.scanSecrets).toBe(true);
      expect(defaultConfig.security.blockOnSecrets).toBe(true);
    });

    it('should have templates disabled by default', () => {
      expect(defaultConfig.templates.enabled).toBe(false);
    });

    it('should have encryption disabled by default', () => {
      expect(defaultConfig.encryption.enabled).toBe(false);
    });
  });

  // ============================================================================
  // clearConfigCache Tests
  // ============================================================================

  describe('clearConfigCache', () => {
    it('should not throw when called', () => {
      expect(() => clearConfigCache()).not.toThrow();
    });

    it('should be idempotent', () => {
      clearConfigCache();
      clearConfigCache();
      clearConfigCache();
      // Should not throw on multiple calls
      expect(true).toBe(true);
    });
  });

  // ============================================================================
  // Config Schema Validation Tests
  // ============================================================================

  describe('config schema', () => {
    it('should have valid structure', () => {
      expect(defaultConfig).toHaveProperty('repository');
      expect(defaultConfig).toHaveProperty('files');
      expect(defaultConfig).toHaveProperty('hooks');
      expect(defaultConfig).toHaveProperty('templates');
      expect(defaultConfig).toHaveProperty('encryption');
      expect(defaultConfig).toHaveProperty('ui');
      expect(defaultConfig).toHaveProperty('security');
      expect(defaultConfig).toHaveProperty('remote');
    });

    it('should have correct remote defaults', () => {
      expect(defaultConfig.remote.mode).toBe('local');
    });

    it('should have correct UI defaults', () => {
      expect(defaultConfig.ui.colors).toBe(true);
      expect(defaultConfig.ui.emoji).toBe(true);
      expect(defaultConfig.ui.verbose).toBe(false);
    });
  });

  // ============================================================================
  // Local Config (.tuckrc.local.json) Tests
  // ============================================================================

  describe('local config override', () => {
    const sharedPath = join(TEST_TUCK_DIR, 'config.json');
    const localPath = join(TEST_TUCK_DIR, 'config.local.json');
    const gitignorePath = join(TEST_TUCK_DIR, '.gitignore');

    it('local defaultGroups overrides shared defaultGroups', async () => {
      vol.writeFileSync(
        sharedPath,
        JSON.stringify({ defaultGroups: ['kubuntu'] })
      );
      vol.writeFileSync(localPath, JSON.stringify({ defaultGroups: ['kali'] }));

      const config = await loadConfig(TEST_TUCK_DIR);
      expect(config.defaultGroups).toEqual(['kali']);
    });

    it('falls back to shared defaultGroups when local is absent', async () => {
      vol.writeFileSync(
        sharedPath,
        JSON.stringify({ defaultGroups: ['kubuntu'] })
      );

      const config = await loadConfig(TEST_TUCK_DIR);
      expect(config.defaultGroups).toEqual(['kubuntu']);
    });

    it('uses defaults when neither shared nor local exists', async () => {
      const config = await loadConfig(TEST_TUCK_DIR);
      expect(config.defaultGroups).toEqual([]);
    });

    it('applies local overrides even when shared config file is absent', async () => {
      vol.writeFileSync(localPath, JSON.stringify({ defaultGroups: ['kali'] }));

      const config = await loadConfig(TEST_TUCK_DIR);
      expect(config.defaultGroups).toEqual(['kali']);
    });

    it('rejects malformed JSON in local config with a clear error', async () => {
      vol.writeFileSync(localPath, '{ not valid json }');

      await expect(loadConfig(TEST_TUCK_DIR)).rejects.toThrow(ConfigError);
      await expect(loadConfig(TEST_TUCK_DIR)).rejects.toThrow(/invalid JSON/i);
    });

    it('rejects unknown fields in local config (strict schema)', async () => {
      vol.writeFileSync(
        localPath,
        JSON.stringify({ defaultGroups: ['kali'], hooks: { preSync: 'bad' } })
      );

      await expect(loadConfig(TEST_TUCK_DIR)).rejects.toThrow(ConfigError);
    });

    it('saveLocalConfig writes to the local file and not the shared file', async () => {
      vol.writeFileSync(sharedPath, JSON.stringify({ defaultGroups: ['shared'] }));

      await saveLocalConfig({ defaultGroups: ['kali'] }, TEST_TUCK_DIR);

      const localContents = JSON.parse(vol.readFileSync(localPath, 'utf-8') as string);
      expect(localContents).toEqual({ defaultGroups: ['kali'] });

      // Shared must be untouched
      const sharedContents = JSON.parse(vol.readFileSync(sharedPath, 'utf-8') as string);
      expect(sharedContents).toEqual({ defaultGroups: ['shared'] });
    });

    it('saveLocalConfig appends .tuckrc.local.json to .gitignore when missing', async () => {
      vol.writeFileSync(gitignorePath, '# existing entries\n.DS_Store\n');

      await saveLocalConfig({ defaultGroups: ['kali'] }, TEST_TUCK_DIR);

      const gitignore = vol.readFileSync(gitignorePath, 'utf-8') as string;
      expect(gitignore).toContain('.tuckrc.local.json');
      expect(gitignore).toContain('.DS_Store');
    });

    it('saveLocalConfig creates .gitignore when the file does not exist', async () => {
      // No pre-existing .gitignore
      await saveLocalConfig({ defaultGroups: ['kali'] }, TEST_TUCK_DIR);

      const gitignore = vol.readFileSync(gitignorePath, 'utf-8') as string;
      expect(gitignore).toContain('.tuckrc.local.json');
    });

    it('saveLocalConfig does not duplicate the .gitignore entry when already present', async () => {
      vol.writeFileSync(gitignorePath, '.tuckrc.local.json\n');

      await saveLocalConfig({ defaultGroups: ['kali'] }, TEST_TUCK_DIR);

      const gitignore = vol.readFileSync(gitignorePath, 'utf-8') as string;
      const matches = gitignore.match(/\.tuckrc\.local\.json/g) ?? [];
      expect(matches.length).toBe(1);
    });

    it('saveLocalConfig invalidates loadConfig cache so subsequent reads see the new value', async () => {
      vol.writeFileSync(sharedPath, JSON.stringify({ defaultGroups: ['kubuntu'] }));
      const before = await loadConfig(TEST_TUCK_DIR);
      expect(before.defaultGroups).toEqual(['kubuntu']);

      await saveLocalConfig({ defaultGroups: ['kali'] }, TEST_TUCK_DIR);

      const after = await loadConfig(TEST_TUCK_DIR);
      expect(after.defaultGroups).toEqual(['kali']);
    });
  });
});
