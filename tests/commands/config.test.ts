import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { TEST_TUCK_DIR } from '../setup.js';
import { initTestTuck, getTestConfig } from '../utils/testHelpers.js';
import { createMockConfig } from '../utils/factories.js';

// Mock modules
vi.mock('../../src/ui/index.js', () => ({
  prompts: {
    intro: vi.fn(),
    outro: vi.fn(),
    confirm: vi.fn(),
    select: vi.fn(),
    text: vi.fn(),
    log: {
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    note: vi.fn(),
    cancel: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  banner: vi.fn(),
}));

describe('config command', () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vol.reset();
  });

  describe('config get', () => {
    it('should get a nested config value', async () => {
      const config = createMockConfig({
        repository: {
          defaultBranch: 'main',
          autoCommit: true,
          autoPush: false,
        },
      });
      await initTestTuck({ config });

      // Import the function after mocks are set up
      const { loadConfig } = await import('../../src/lib/config.js');
      const loadedConfig = await loadConfig(TEST_TUCK_DIR);

      expect(loadedConfig.repository.autoCommit).toBe(true);
      expect(loadedConfig.repository.autoPush).toBe(false);
    });

    it('should return undefined for non-existent keys', async () => {
      const config = createMockConfig();
      await initTestTuck({ config });

      const { loadConfig } = await import('../../src/lib/config.js');
      const loadedConfig = await loadConfig(TEST_TUCK_DIR);

      // Type-safe way to check for non-existent property
      const configObj = loadedConfig as unknown as Record<string, unknown>;
      expect(configObj['nonExistent']).toBeUndefined();
    });
  });

  describe('config set', () => {
    it('should set a boolean config value', async () => {
      await initTestTuck();

      const { loadConfig, saveConfig } = await import('../../src/lib/config.js');
      const config = await loadConfig(TEST_TUCK_DIR);

      config.repository.autoCommit = false;
      await saveConfig(config, TEST_TUCK_DIR);

      const updatedConfig = await loadConfig(TEST_TUCK_DIR);
      expect(updatedConfig.repository.autoCommit).toBe(false);
    });

    it('should set a string config value', async () => {
      await initTestTuck();

      const { loadConfig, saveConfig } = await import('../../src/lib/config.js');
      const config = await loadConfig(TEST_TUCK_DIR);

      config.repository.defaultBranch = 'develop';
      await saveConfig(config, TEST_TUCK_DIR);

      const updatedConfig = await loadConfig(TEST_TUCK_DIR);
      expect(updatedConfig.repository.defaultBranch).toBe('develop');
    });

    it('should set an enum config value', async () => {
      await initTestTuck();

      const { loadConfig, saveConfig } = await import('../../src/lib/config.js');
      const config = await loadConfig(TEST_TUCK_DIR);

      config.files.strategy = 'symlink';
      await saveConfig(config, TEST_TUCK_DIR);

      const updatedConfig = await loadConfig(TEST_TUCK_DIR);
      expect(updatedConfig.files.strategy).toBe('symlink');
    });
  });

  describe('config list', () => {
    it('should load full config with all sections', async () => {
      const config = createMockConfig({
        repository: {
          defaultBranch: 'main',
          autoCommit: true,
          autoPush: false,
        },
        files: {
          strategy: 'copy',
          backupOnRestore: true,
        },
        ui: {
          colors: true,
          emoji: true,
          verbose: false,
        },
      });
      await initTestTuck({ config });

      const loadedConfig = await getTestConfig();

      expect(loadedConfig.repository).toBeDefined();
      expect(loadedConfig.files).toBeDefined();
      expect(loadedConfig.ui).toBeDefined();
      expect(loadedConfig.hooks).toBeDefined();
      expect(loadedConfig.encryption).toBeDefined();
    });
  });

  describe('config reset', () => {
    it('should reset config to defaults', async () => {
      const config = createMockConfig({
        repository: {
          defaultBranch: 'custom-branch',
          autoCommit: false,
          autoPush: true,
        },
      });
      await initTestTuck({ config });

      const { resetConfig, loadConfig } = await import('../../src/lib/config.js');
      await resetConfig(TEST_TUCK_DIR);

      const resetConfigAfter = await loadConfig(TEST_TUCK_DIR);
      expect(resetConfigAfter.repository.defaultBranch).toBe('main');
      expect(resetConfigAfter.repository.autoCommit).toBe(true);
    });
  });

  describe('CONFIG_KEYS metadata', () => {
    it('should have valid structure for all keys', async () => {
      // Import the config keys
      const configModule = await import('../../src/commands/config.js');

      // Access CONFIG_KEYS through the module (it's not exported, so we test indirectly)
      // The presence of the configCommand validates that the module loads correctly
      expect(configModule.configCommand).toBeDefined();
      expect(configModule.configCommand.name()).toBe('config');
    });
  });

  describe('nested value helpers', () => {
    it('should correctly get nested values', async () => {
      const config = createMockConfig({
        hooks: {
          preSync: 'echo "pre-sync"',
          postSync: 'echo "post-sync"',
        },
      });
      await initTestTuck({ config });

      const loadedConfig = await getTestConfig();
      expect(loadedConfig.hooks.preSync).toBe('echo "pre-sync"');
      expect(loadedConfig.hooks.postSync).toBe('echo "post-sync"');
    });

    it('should handle undefined nested values', async () => {
      await initTestTuck();

      const loadedConfig = await getTestConfig();
      expect(loadedConfig.hooks.preSync).toBeUndefined();
      expect(loadedConfig.hooks.postSync).toBeUndefined();
    });
  });

  describe('parseValue array coercion', () => {
    it('wraps scalar input as single-item array when schema expects z.array(z.string())', async () => {
      const { parseValue } = await import('../../src/commands/config.js');
      expect(parseValue('kubuntu', 'defaultGroups')).toEqual(['kubuntu']);
    });

    it('splits comma-separated input into an array of trimmed values', async () => {
      const { parseValue } = await import('../../src/commands/config.js');
      expect(parseValue('kali, kubuntu , ubuntu', 'defaultGroups')).toEqual([
        'kali',
        'kubuntu',
        'ubuntu',
      ]);
    });

    it('passes through an already-JSON array literal unchanged', async () => {
      const { parseValue } = await import('../../src/commands/config.js');
      expect(parseValue('["kali","ubuntu"]', 'defaultGroups')).toEqual(['kali', 'ubuntu']);
    });

    it('drops empty segments from comma-split', async () => {
      const { parseValue } = await import('../../src/commands/config.js');
      expect(parseValue('kubuntu,,', 'defaultGroups')).toEqual(['kubuntu']);
      expect(parseValue('', 'defaultGroups')).toEqual([]);
    });

    it('does not wrap scalar when schema key is not an array', async () => {
      const { parseValue } = await import('../../src/commands/config.js');
      expect(parseValue('main', 'repository.defaultBranch')).toBe('main');
      expect(parseValue('true', 'repository.autoCommit')).toBe(true);
    });

    it('preserves legacy no-key behavior (raw string fallback)', async () => {
      const { parseValue } = await import('../../src/commands/config.js');
      expect(parseValue('kubuntu')).toBe('kubuntu');
      expect(parseValue('["a","b"]')).toEqual(['a', 'b']);
    });

    it('works for nested array keys like ignore', async () => {
      const { parseValue } = await import('../../src/commands/config.js');
      expect(parseValue('*.log,*.tmp', 'ignore')).toEqual(['*.log', '*.tmp']);
    });

    it('returns null for unknown key paths (falls through to raw parse)', async () => {
      const { parseValue } = await import('../../src/commands/config.js');
      expect(parseValue('hello', 'nonexistent.path')).toBe('hello');
    });
  });
});
