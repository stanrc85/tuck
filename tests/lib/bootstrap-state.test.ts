import { describe, it, expect, beforeEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import {
  loadBootstrapState,
  saveBootstrapState,
  recordToolInstalled,
  removeToolState,
  computeDefinitionHash,
  emptyBootstrapState,
  getBootstrapStatePath,
  STATE_FILE,
  STATE_VERSION,
} from '../../src/lib/bootstrap/state.js';
import type { ToolDefinition } from '../../src/schemas/bootstrap.schema.js';
import { BootstrapError } from '../../src/errors.js';
import { TEST_TUCK_DIR } from '../setup.js';

const tool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id: 'pet',
  description: 'CLI snippet manager',
  install: 'apt install pet',
  requires: [],
  detect: { paths: [], rcReferences: [] },
  ...overrides,
});

const statePath = join(TEST_TUCK_DIR, STATE_FILE);

describe('bootstrap state', () => {
  beforeEach(() => {
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
  });

  describe('loadBootstrapState', () => {
    it('returns empty state when the file is absent', async () => {
      const state = await loadBootstrapState(TEST_TUCK_DIR);
      expect(state).toEqual(emptyBootstrapState());
      expect(state.version).toBe(STATE_VERSION);
      expect(state.tools).toEqual({});
    });

    it('parses a well-formed state file', async () => {
      vol.writeFileSync(
        statePath,
        JSON.stringify({
          version: 1,
          tools: {
            pet: {
              installedAt: '2026-04-20T12:00:00Z',
              version: '1.0.1',
              definitionHash: 'sha256:abc123',
            },
          },
        })
      );
      const state = await loadBootstrapState(TEST_TUCK_DIR);
      expect(state.tools.pet?.version).toBe('1.0.1');
      expect(state.tools.pet?.definitionHash).toBe('sha256:abc123');
    });

    it('throws BootstrapError on malformed JSON with a fix hint', async () => {
      vol.writeFileSync(statePath, '{ not json');
      await expect(loadBootstrapState(TEST_TUCK_DIR)).rejects.toBeInstanceOf(BootstrapError);
      try {
        await loadBootstrapState(TEST_TUCK_DIR);
      } catch (err) {
        expect((err as BootstrapError).suggestions?.some((s) => s.includes(statePath))).toBe(true);
      }
    });

    it('throws BootstrapError when the schema version mismatches', async () => {
      vol.writeFileSync(statePath, JSON.stringify({ version: 2, tools: {} }));
      await expect(loadBootstrapState(TEST_TUCK_DIR)).rejects.toBeInstanceOf(BootstrapError);
    });

    it('throws BootstrapError when a tool entry lacks definitionHash', async () => {
      vol.writeFileSync(
        statePath,
        JSON.stringify({
          version: 1,
          tools: { pet: { installedAt: '2026-04-20T00:00:00Z' } },
        })
      );
      await expect(loadBootstrapState(TEST_TUCK_DIR)).rejects.toBeInstanceOf(BootstrapError);
    });
  });

  describe('saveBootstrapState', () => {
    it('writes a JSON file that round-trips through loadBootstrapState', async () => {
      const state = emptyBootstrapState();
      state.tools.fzf = {
        installedAt: '2026-04-20T00:00:00.000Z',
        definitionHash: 'sha256:zzz',
      };
      await saveBootstrapState(state, TEST_TUCK_DIR);
      expect(vol.existsSync(statePath)).toBe(true);
      const roundtrip = await loadBootstrapState(TEST_TUCK_DIR);
      expect(roundtrip).toEqual(state);
    });

    it('creates the tuck dir if missing', async () => {
      const freshDir = '/test-home/.tuck-fresh';
      const state = emptyBootstrapState();
      await saveBootstrapState(state, freshDir);
      expect(vol.existsSync(getBootstrapStatePath(freshDir))).toBe(true);
    });

    it('appends .bootstrap-state.json to .gitignore on save (creates if missing)', async () => {
      const state = emptyBootstrapState();
      await saveBootstrapState(state, TEST_TUCK_DIR);
      const gitignore = vol.readFileSync(join(TEST_TUCK_DIR, '.gitignore'), 'utf-8') as string;
      expect(gitignore).toContain(STATE_FILE);
    });

    it('does not duplicate the .gitignore entry on subsequent saves', async () => {
      await saveBootstrapState(emptyBootstrapState(), TEST_TUCK_DIR);
      await saveBootstrapState(emptyBootstrapState(), TEST_TUCK_DIR);
      const gitignore = vol.readFileSync(join(TEST_TUCK_DIR, '.gitignore'), 'utf-8') as string;
      const occurrences = gitignore.split(STATE_FILE).length - 1;
      expect(occurrences).toBe(1);
    });

    it('preserves existing .gitignore contents when adding the entry', async () => {
      const gitignorePath = join(TEST_TUCK_DIR, '.gitignore');
      vol.writeFileSync(gitignorePath, 'node_modules\n.DS_Store\n');
      await saveBootstrapState(emptyBootstrapState(), TEST_TUCK_DIR);
      const gitignore = vol.readFileSync(gitignorePath, 'utf-8') as string;
      expect(gitignore).toContain('node_modules');
      expect(gitignore).toContain('.DS_Store');
      expect(gitignore).toContain(STATE_FILE);
    });

    it('no-ops if .bootstrap-state.json is already in .gitignore', async () => {
      const gitignorePath = join(TEST_TUCK_DIR, '.gitignore');
      const before = `node_modules\n${STATE_FILE}\n`;
      vol.writeFileSync(gitignorePath, before);
      await saveBootstrapState(emptyBootstrapState(), TEST_TUCK_DIR);
      const after = vol.readFileSync(gitignorePath, 'utf-8') as string;
      expect(after).toBe(before);
    });
  });

  describe('recordToolInstalled', () => {
    it('creates the first entry from an empty state', async () => {
      const state = await recordToolInstalled('pet', 'sha256:abc', {
        version: '1.0.1',
        tuckDir: TEST_TUCK_DIR,
        now: new Date('2026-04-20T00:00:00Z'),
      });
      expect(state.tools.pet).toEqual({
        installedAt: '2026-04-20T00:00:00.000Z',
        version: '1.0.1',
        definitionHash: 'sha256:abc',
      });
    });

    it('updates an existing entry without disturbing siblings', async () => {
      await recordToolInstalled('fzf', 'sha256:fzf1', {
        tuckDir: TEST_TUCK_DIR,
        now: new Date('2026-04-01T00:00:00Z'),
      });
      const state = await recordToolInstalled('pet', 'sha256:pet1', {
        version: '1.0.1',
        tuckDir: TEST_TUCK_DIR,
        now: new Date('2026-04-20T00:00:00Z'),
      });
      expect(Object.keys(state.tools).sort()).toEqual(['fzf', 'pet']);
      expect(state.tools.fzf?.definitionHash).toBe('sha256:fzf1');
    });

    it('omits the version field when not supplied (versionless tools)', async () => {
      const state = await recordToolInstalled('neovim', 'sha256:nvim', {
        tuckDir: TEST_TUCK_DIR,
      });
      expect(state.tools.neovim?.version).toBeUndefined();
      expect(state.tools.neovim?.definitionHash).toBe('sha256:nvim');
    });
  });

  describe('removeToolState', () => {
    it('removes an existing entry and persists the change', async () => {
      await recordToolInstalled('pet', 'sha256:pet1', { tuckDir: TEST_TUCK_DIR });
      await recordToolInstalled('fzf', 'sha256:fzf1', { tuckDir: TEST_TUCK_DIR });
      const state = await removeToolState('pet', TEST_TUCK_DIR);
      expect(state.tools.pet).toBeUndefined();
      expect(state.tools.fzf).toBeDefined();
      const roundtrip = await loadBootstrapState(TEST_TUCK_DIR);
      expect(roundtrip.tools.pet).toBeUndefined();
    });

    it('is a no-op when the tool was never recorded', async () => {
      const state = await removeToolState('ghost', TEST_TUCK_DIR);
      expect(state).toEqual(emptyBootstrapState());
    });
  });

  describe('computeDefinitionHash', () => {
    it('produces a stable sha256: prefixed hex digest', () => {
      const h = computeDefinitionHash(tool());
      expect(h).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('is identical for identical definitions', () => {
      expect(computeDefinitionHash(tool())).toBe(computeDefinitionHash(tool()));
    });

    it('differs when the install script changes', () => {
      const a = computeDefinitionHash(tool({ install: 'apt install pet' }));
      const b = computeDefinitionHash(tool({ install: 'brew install pet' }));
      expect(a).not.toBe(b);
    });

    it('differs when the version changes', () => {
      const a = computeDefinitionHash(tool({ version: '1.0.0' }));
      const b = computeDefinitionHash(tool({ version: '1.0.1' }));
      expect(a).not.toBe(b);
    });

    it('is invariant to `requires` array order (treated as a set)', () => {
      const a = computeDefinitionHash(tool({ requires: ['fzf', 'zsh'] }));
      const b = computeDefinitionHash(tool({ requires: ['zsh', 'fzf'] }));
      expect(a).toBe(b);
    });

    it('is invariant to detect.paths / detect.rcReferences order', () => {
      const a = computeDefinitionHash(
        tool({ detect: { paths: ['~/a', '~/b'], rcReferences: ['x', 'y'] } })
      );
      const b = computeDefinitionHash(
        tool({ detect: { paths: ['~/b', '~/a'], rcReferences: ['y', 'x'] } })
      );
      expect(a).toBe(b);
    });

    it('treats a missing optional field differently from the same string', () => {
      const withVersion = computeDefinitionHash(tool({ version: '' }));
      const withoutVersion = computeDefinitionHash(tool());
      expect(withVersion).not.toBe(withoutVersion);
    });
  });
});
