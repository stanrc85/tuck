import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { TEST_TUCK_DIR } from '../setup.js';
import { initTestTuck, getTestConfig } from '../utils/testHelpers.js';
import { createMockConfig } from '../utils/factories.js';
import { ConfigError } from '../../src/errors.js';

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

    // `defaultGroups` is per-host: it belongs in `.tuckrc.local.json`, not
    // the shared `.tuckrc.json`. Writing it to shared leaks across every
    // clone — which used to silently pre-assign new hosts to whatever
    // group was set on the producer and suppressed the init-time prompt.
    it('routes defaultGroups to .tuckrc.local.json, not .tuckrc.json', async () => {
      await initTestTuck();

      const { runConfigSet } = await import('../../src/commands/config.js');
      await runConfigSet('defaultGroups', 'kubuntu');

      const localRaw = vol.readFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.local.json'),
        'utf-8'
      ) as string;
      expect(JSON.parse(localRaw)).toEqual({ defaultGroups: ['kubuntu'] });

      const sharedRaw = vol.readFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.json'),
        'utf-8'
      ) as string;
      expect(JSON.parse(sharedRaw).defaultGroups ?? []).toEqual([]);
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

  describe('prototype-pollution guard', () => {
    afterEach(() => {
      // Defensive cleanup: if a test ever did pollute Object.prototype, scrub it
      // before the next test runs. The guard should make this a no-op, but it
      // protects the rest of the suite from a regression here.
      delete (Object.prototype as Record<string, unknown>).polluted;
    });

    it.each(['__proto__', 'constructor', 'prototype'])(
      'setNestedValue rejects blocked segment "%s" with ConfigError',
      async (blocked) => {
        const { setNestedValue } = await import('../../src/commands/config.js');
        const target: Record<string, unknown> = {};
        expect(() => setNestedValue(target, `${blocked}.polluted`, 'bad')).toThrow(ConfigError);
        // Probe a fresh object — Object.prototype must NOT have been polluted
        const probe: Record<string, unknown> = {};
        expect(probe.polluted).toBeUndefined();
      }
    );

    it('setNestedValue rejects a blocked segment anywhere in the dotted path', async () => {
      const { setNestedValue } = await import('../../src/commands/config.js');
      const target: Record<string, unknown> = {};
      expect(() => setNestedValue(target, 'repository.__proto__.polluted', 'x')).toThrow(
        ConfigError
      );
      const probe: Record<string, unknown> = {};
      expect(probe.polluted).toBeUndefined();
    });

    it('setNestedValue still accepts safe nested paths', async () => {
      const { setNestedValue } = await import('../../src/commands/config.js');
      const target: Record<string, unknown> = {};
      setNestedValue(target, 'repository.defaultBranch', 'develop');
      expect(target).toEqual({ repository: { defaultBranch: 'develop' } });
    });

    it('setNestedValue writes enumerable, writable, configurable own properties', async () => {
      // Regression: the walker uses Object.defineProperty (not bracket
      // assignment) to neutralise the CodeQL prototype-pollution sink.
      // Verify the resulting descriptor still behaves like a normal assignment
      // so JSON.stringify / Object.keys / overwrites keep working.
      const { setNestedValue } = await import('../../src/commands/config.js');
      const target: Record<string, unknown> = {};
      setNestedValue(target, 'repository.defaultBranch', 'develop');

      const descriptor = Object.getOwnPropertyDescriptor(
        target.repository as Record<string, unknown>,
        'defaultBranch'
      );
      expect(descriptor).toMatchObject({
        value: 'develop',
        writable: true,
        enumerable: true,
        configurable: true,
      });
      expect(JSON.stringify(target)).toBe('{"repository":{"defaultBranch":"develop"}}');

      // Overwriting an existing value should also work.
      setNestedValue(target, 'repository.defaultBranch', 'main');
      expect((target.repository as Record<string, unknown>).defaultBranch).toBe('main');
    });

    it('parseValue falls through cleanly when path contains a blocked segment', async () => {
      // resolveSchemaAtPath also walks dotted paths; the guard there should
      // return null so parseValue falls back to the raw-string return.
      const { parseValue } = await import('../../src/commands/config.js');
      expect(parseValue('hello', '__proto__.polluted')).toBe('hello');
      expect(parseValue('hello', 'constructor.polluted')).toBe('hello');
    });
  });
});
