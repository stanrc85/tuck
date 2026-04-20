import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { runBootstrapUpdate } from '../../src/commands/bootstrap-update.js';
import { NonInteractivePromptError } from '../../src/errors.js';
import {
  recordToolInstalled,
  computeDefinitionHash,
  STATE_FILE,
} from '../../src/lib/bootstrap/state.js';
import type { ToolDefinition } from '../../src/schemas/bootstrap.schema.js';
import { TEST_TUCK_DIR } from '../setup.js';

// bootstrap-update.test.ts covers selection logic and --check. Actual
// subprocess-level update execution (runUpdate, state bump) is covered by
// bootstrap-orchestrator.test.ts > phase: 'update'. We avoid --all without
// --dry-run here because it would spawn real shells, and the dry-run path
// exercises the same selection + plan + state-read logic minus the spawn.

const writeBootstrapToml = (content: string): string => {
  vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
  const path = join(TEST_TUCK_DIR, 'bootstrap.toml');
  vol.writeFileSync(path, content);
  return path;
};

const makeTool = (id: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id,
  description: `desc for ${id}`,
  install: `install-${id}`,
  requires: [],
  detect: { paths: [], rcReferences: [] },
  ...overrides,
});

const seedState = async (
  id: string,
  tool: ToolDefinition,
  opts: { stateVersion?: string; hashOverride?: string } = {}
): Promise<void> => {
  const hash = opts.hashOverride ?? computeDefinitionHash(tool);
  await recordToolInstalled(id, hash, {
    ...(opts.stateVersion !== undefined ? { version: opts.stateVersion } : {}),
    tuckDir: TEST_TUCK_DIR,
    now: new Date('2025-01-01T00:00:00Z'),
  });
};

describe('runBootstrapUpdate', () => {
  // process.exitCode leaks across tests because --check sets it as a
  // scriptable signal. Reset between cases.
  const originalExitCode = process.exitCode;
  beforeEach(() => {
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  describe('empty state', () => {
    it('exits cleanly when no tools are installed', async () => {
      // No state file seeded — treated as empty state.
      const result = await runBootstrapUpdate({ all: true });
      expect(result.counts).toBeNull();
      expect(result.plan).toBeNull();
    });
  });

  describe('--check', () => {
    it('reports no pending when state matches catalog exactly', async () => {
      const tool = makeTool('fzf', {
        install: 'apt-get install -y fzf',
        update: 'apt-get install -y --only-upgrade fzf',
      });
      await seedState('fzf', tool);
      // Empty user toml so only built-ins merge — and we disable them all
      // except our seeded tool by writing it into user config.
      writeBootstrapToml(`
[[tool]]
id = "fzf"
description = "${tool.description}"
install = "${tool.install}"
update = "${tool.update}"

[registry]
disabled = ["fzf", "eza", "bat", "fd", "neovim", "neovim-plugins", "pet", "yazi"]
`);

      const result = await runBootstrapUpdate({ check: true });
      expect(result.pending).toEqual([]);
      expect(process.exitCode).toBe(0);
    });

    it('flags version-bumped tools as pending with exit code 1', async () => {
      const oldTool = makeTool('pet', { install: 'install-pet', version: '1.0.0' });
      await seedState('pet', oldTool, { stateVersion: '1.0.0' });

      // Catalog has pet at 1.1.0 — version bump.
      writeBootstrapToml(`
[[tool]]
id = "pet"
description = "snippet manager"
install = "install-pet"
version = "1.1.0"

[registry]
disabled = ["fzf", "eza", "bat", "fd", "neovim", "neovim-plugins", "pet", "yazi"]
`);

      const result = await runBootstrapUpdate({ check: true });
      expect(result.pending).toHaveLength(1);
      expect(result.pending?.[0]?.id).toBe('pet');
      expect(result.pending?.[0]?.versionBump).toBe(true);
      expect(result.pending?.[0]?.catalogVersion).toBe('1.1.0');
      expect(result.pending?.[0]?.installedVersion).toBe('1.0.0');
      expect(process.exitCode).toBe(1);
    });

    it('flags hash-drifted tools as pending even when version is unchanged', async () => {
      // Seed state with an OLD install script hash; catalog now has a new
      // install block. Same version → hash drift only.
      const oldTool = makeTool('fzf', { install: 'old-install-fzf' });
      await seedState('fzf', oldTool);

      writeBootstrapToml(`
[[tool]]
id = "fzf"
description = "fuzzy finder"
install = "new-install-fzf"

[registry]
disabled = ["fzf", "eza", "bat", "fd", "neovim", "neovim-plugins", "pet", "yazi"]
`);

      const result = await runBootstrapUpdate({ check: true });
      expect(result.pending).toHaveLength(1);
      expect(result.pending?.[0]?.id).toBe('fzf');
      expect(result.pending?.[0]?.versionBump).toBe(false);
      expect(result.pending?.[0]?.hashDrift).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it('does not count orphaned tools as pending (catalog definition missing)', async () => {
      // Seed an install for "ghost" — no matching catalog entry.
      const ghost = makeTool('ghost');
      await seedState('ghost', ghost);

      // Empty user toml + built-ins disabled → ghost has no catalog mate.
      writeBootstrapToml(`
[registry]
disabled = ["fzf", "eza", "bat", "fd", "neovim", "neovim-plugins", "pet", "yazi"]
`);

      const result = await runBootstrapUpdate({ check: true });
      expect(result.pending).toEqual([]);
      expect(process.exitCode).toBe(0);
    });
  });

  describe('selection', () => {
    it('--tools skips ids not in state with a warning and continues with the rest (dry-run)', async () => {
      const fzf = makeTool('fzf');
      await seedState('fzf', fzf);

      writeBootstrapToml(`
[[tool]]
id = "fzf"
description = "fuzzy finder"
install = "install-fzf"

[[tool]]
id = "unknown-but-in-catalog"
description = "x"
install = "install-x"

[registry]
disabled = ["fzf", "eza", "bat", "fd", "neovim", "neovim-plugins", "pet", "yazi"]
`);

      const result = await runBootstrapUpdate({
        tools: 'fzf,unknown-but-in-catalog',
        dryRun: true,
      });
      // unknown-but-in-catalog is in catalog but not in state — must be
      // dropped from the plan.
      expect(result.plan?.ordered.map((t) => t.id)).toEqual(['fzf']);
      expect(result.dryRun).toBe(true);
    });

    it('drops orphaned ids (in state but missing from catalog) with a warning', async () => {
      const ghost = makeTool('ghost');
      await seedState('ghost', ghost);
      const fzf = makeTool('fzf');
      await seedState('fzf', fzf);

      writeBootstrapToml(`
[[tool]]
id = "fzf"
description = "fuzzy finder"
install = "install-fzf"

[registry]
disabled = ["fzf", "eza", "bat", "fd", "neovim", "neovim-plugins", "pet", "yazi"]
`);

      const result = await runBootstrapUpdate({ tools: 'fzf,ghost', dryRun: true });
      expect(result.plan?.ordered.map((t) => t.id)).toEqual(['fzf']);
    });

    it('--all expands to every installed tool (dry-run)', async () => {
      const fzf = makeTool('fzf');
      const pet = makeTool('pet', { requires: ['fzf'] });
      await seedState('fzf', fzf);
      await seedState('pet', pet);

      writeBootstrapToml(`
[[tool]]
id = "fzf"
description = "fuzzy finder"
install = "install-fzf"

[[tool]]
id = "pet"
description = "snippet"
install = "install-pet"
requires = ["fzf"]

[registry]
disabled = ["fzf", "eza", "bat", "fd", "neovim", "neovim-plugins", "pet", "yazi"]
`);

      const result = await runBootstrapUpdate({ all: true, dryRun: true });
      // fzf precedes pet (pet requires fzf; both in selection → resolver
      // still orders them).
      const ids = result.plan!.ordered.map((t) => t.id);
      expect(ids.indexOf('fzf')).toBeLessThan(ids.indexOf('pet'));
      expect(ids.sort()).toEqual(['fzf', 'pet']);
    });

    it('throws NonInteractivePromptError when no --all/--tools in non-TTY mode', async () => {
      const fzf = makeTool('fzf');
      await seedState('fzf', fzf);
      writeBootstrapToml(`
[[tool]]
id = "fzf"
description = "fuzzy finder"
install = "install-fzf"

[registry]
disabled = ["fzf", "eza", "bat", "fd", "neovim", "neovim-plugins", "pet", "yazi"]
`);

      await expect(runBootstrapUpdate({})).rejects.toBeInstanceOf(
        NonInteractivePromptError
      );
    });
  });

  it('writes state file during seed (sanity check for shared memfs)', async () => {
    // Guards against memfs bleed-through — if an earlier test's state
    // survived we'd see bogus pending results. This should be a fresh
    // vol after beforeEach's vol.reset.
    expect(vol.existsSync(join(TEST_TUCK_DIR, STATE_FILE))).toBe(false);
  });
});
