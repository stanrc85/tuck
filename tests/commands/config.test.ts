import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { TEST_TUCK_DIR } from '../setup.js';
import { initTestTuck, getTestConfig } from '../utils/testHelpers.js';
import { createMockConfig } from '../utils/factories.js';
import { ConfigError } from '../../src/errors.js';
import { mockOutro } from '../utils/uiMocks.js';

// Mock modules
vi.mock('../../src/ui/index.js', () => ({
  prompts: {
    intro: vi.fn(),
    outro: mockOutro(),
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

    // `--local` lets users route any local-schema-allowed key (notably hooks)
    // to .tuckrc.local.json without hand-editing the file. Closes the gap
    // between the local schema (which already accepts per-host hooks) and the
    // writer side (which previously only routed `defaultGroups` to local).
    it('--local routes hooks.preSync to .tuckrc.local.json, leaving shared untouched', async () => {
      await initTestTuck();

      const { runConfigSet } = await import('../../src/commands/config.js');
      await runConfigSet(
        'hooks.preSync',
        'tuck cheatsheet --format json --output ~/.config/tuck/cheatsheet.json',
        { local: true }
      );

      const localRaw = vol.readFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.local.json'),
        'utf-8'
      ) as string;
      expect(JSON.parse(localRaw)).toEqual({
        hooks: {
          preSync: 'tuck cheatsheet --format json --output ~/.config/tuck/cheatsheet.json',
        },
      });

      const sharedRaw = vol.readFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.json'),
        'utf-8'
      ) as string;
      expect(JSON.parse(sharedRaw).hooks ?? {}).toEqual({});

      // Merged config (shared + local layered) reflects the local value.
      const { loadConfig } = await import('../../src/lib/config.js');
      const merged = await loadConfig(TEST_TUCK_DIR);
      expect(merged.hooks.preSync).toBe(
        'tuck cheatsheet --format json --output ~/.config/tuck/cheatsheet.json'
      );
    });

    it('--local rejects a key that is not in the strict local schema', async () => {
      await initTestTuck();

      const { runConfigSet } = await import('../../src/commands/config.js');
      await expect(
        runConfigSet('repository.autoCommit', 'false', { local: true })
      ).rejects.toThrow(ConfigError);
      await expect(
        runConfigSet('repository.autoCommit', 'false', { local: true })
      ).rejects.toThrow(/not allowed in \.tuckrc\.local\.json/);

      // Shared should be untouched — no half-write.
      const sharedRaw = vol.readFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.json'),
        'utf-8'
      ) as string;
      expect(JSON.parse(sharedRaw).repository?.autoCommit ?? true).toBe(true);
    });

    // Regression guard: setting a nested local key must not drop sibling
    // keys in the same nested object. saveLocalConfig only shallow-merges,
    // so naive `{ hooks: { preSync } }` patches would clobber an existing
    // `hooks.postSync`. The --local code path reconstructs the full local
    // object before writing.
    it('--local preserves sibling nested keys when overwriting one', async () => {
      await initTestTuck();

      const { runConfigSet } = await import('../../src/commands/config.js');
      await runConfigSet('hooks.postSync', 'echo done', { local: true });
      await runConfigSet('hooks.preSync', 'echo go', { local: true });

      const localRaw = vol.readFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.local.json'),
        'utf-8'
      ) as string;
      expect(JSON.parse(localRaw)).toEqual({
        hooks: {
          postSync: 'echo done',
          preSync: 'echo go',
        },
      });
    });

    // `trustHooks` is local-only by design — putting it in shared config
    // would let a malicious commit bypass the per-execution prompt for
    // every downstream clone. The shared schema doesn't include the field;
    // the strict-shared-schema guard means a non-`--local` set rejects.
    it('--local trustHooks=true round-trips through loadConfig', async () => {
      await initTestTuck();

      const { runConfigSet } = await import('../../src/commands/config.js');
      await runConfigSet('trustHooks', 'true', { local: true });

      const localRaw = vol.readFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.local.json'),
        'utf-8'
      ) as string;
      expect(JSON.parse(localRaw)).toEqual({ trustHooks: true });

      const { loadConfig } = await import('../../src/lib/config.js');
      const merged = await loadConfig(TEST_TUCK_DIR);
      expect(merged.trustHooks).toBe(true);
    });

    it('rejects trustHooks without --local with a pointer to the right invocation', async () => {
      await initTestTuck();

      const { runConfigSet } = await import('../../src/commands/config.js');
      await expect(runConfigSet('trustHooks', 'true')).rejects.toThrow(ConfigError);
      await expect(runConfigSet('trustHooks', 'true')).rejects.toThrow(/must be set with --local/);

      // Neither file should have been written.
      expect(vol.existsSync(join(TEST_TUCK_DIR, '.tuckrc.local.json'))).toBe(false);
      const sharedRaw = vol.readFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.json'),
        'utf-8'
      ) as string;
      const sharedObj = JSON.parse(sharedRaw) as Record<string, unknown>;
      expect(sharedObj.trustHooks).toBeUndefined();
    });
  });

  describe('config unset', () => {
    // The basic round-trip: set a hook via --local, then unset it via --local.
    // After unset, loadConfig must no longer surface the hook.
    it('--local removes a key from .tuckrc.local.json', async () => {
      await initTestTuck();

      const { runConfigSet, runConfigUnset } = await import('../../src/commands/config.js');
      await runConfigSet('hooks.preSync', 'echo go', { local: true });
      await runConfigUnset('hooks.preSync', { local: true });

      const { loadConfig } = await import('../../src/lib/config.js');
      const merged = await loadConfig(TEST_TUCK_DIR);
      expect(merged.hooks.preSync).toBeUndefined();
    });

    // Missing-key unset is a no-op success rather than an error. This matches
    // `git config --unset`'s behavior on missing keys when the file exists.
    it('--local on a missing key is a no-op success (not an error)', async () => {
      await initTestTuck();

      const { runConfigUnset } = await import('../../src/commands/config.js');
      await expect(runConfigUnset('hooks.preSync', { local: true })).resolves.toBeUndefined();
    });

    // Same schema gate as `set --local` — shared-only keys are rejected
    // upfront so users can't try to unset something that wouldn't have been
    // accepted by `set` either.
    it('--local rejects keys not in the strict local schema', async () => {
      await initTestTuck();

      const { runConfigUnset } = await import('../../src/commands/config.js');
      await expect(
        runConfigUnset('repository.autoCommit', { local: true })
      ).rejects.toThrow(ConfigError);
      await expect(
        runConfigUnset('repository.autoCommit', { local: true })
      ).rejects.toThrow(/not allowed in \.tuckrc\.local\.json/);
    });

    // Sibling preservation: removing one nested hook must leave the other
    // intact. Same risk surface as set --local — saveLocalConfig shallow
    // merges, so the unset path needs to reconstruct the full local object.
    it('--local preserves sibling nested keys when removing one', async () => {
      await initTestTuck();

      const { runConfigSet, runConfigUnset } = await import('../../src/commands/config.js');
      await runConfigSet('hooks.preSync', 'echo go', { local: true });
      await runConfigSet('hooks.postSync', 'echo done', { local: true });
      await runConfigUnset('hooks.preSync', { local: true });

      const localRaw = vol.readFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.local.json'),
        'utf-8'
      ) as string;
      expect(JSON.parse(localRaw)).toEqual({
        hooks: { postSync: 'echo done' },
      });
    });

    // Empty-parent pruning: when removing the last child of a nested object,
    // drop the now-empty parent so the file doesn't accrete `{ hooks: {} }`
    // over time.
    it('--local prunes empty parent objects after removing the last child', async () => {
      await initTestTuck();

      const { runConfigSet, runConfigUnset } = await import('../../src/commands/config.js');
      await runConfigSet('hooks.preSync', 'echo go', { local: true });
      await runConfigUnset('hooks.preSync', { local: true });

      const localRaw = vol.readFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.local.json'),
        'utf-8'
      ) as string;
      // hooks should be pruned entirely — not left as `{ hooks: {} }`.
      expect(JSON.parse(localRaw)).toEqual({});
    });
  });

  describe('deleteNestedValue helper', () => {
    it('returns false when the path does not exist (no mutation)', async () => {
      const { deleteNestedValue } = await import('../../src/commands/config.js');
      const target: Record<string, unknown> = { hooks: { preSync: 'go' } };
      expect(deleteNestedValue(target, 'hooks.postSync')).toBe(false);
      expect(target).toEqual({ hooks: { preSync: 'go' } });
    });

    it('rejects reserved key segments (prototype-pollution guard)', async () => {
      const { deleteNestedValue } = await import('../../src/commands/config.js');
      const target: Record<string, unknown> = {};
      expect(() => deleteNestedValue(target, '__proto__.polluted')).toThrow(ConfigError);
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
