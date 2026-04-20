import { describe, it, expect, beforeEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { runBootstrap } from '../../src/commands/bootstrap.js';
import { BootstrapError, NonInteractivePromptError } from '../../src/errors.js';
import { TEST_TUCK_DIR } from '../setup.js';

const writeBootstrapToml = (content: string): string => {
  vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
  const path = join(TEST_TUCK_DIR, 'bootstrap.toml');
  vol.writeFileSync(path, content);
  return path;
};

const SIMPLE_TOML = `
[[tool]]
id = "fzf"
description = "fuzzy finder"
install = "apt install -y fzf"

[[tool]]
id = "pet"
description = "snippet manager"
install = "apt install -y pet"
requires = ["fzf"]

[[tool]]
id = "eza"
description = "better ls"
install = "apt install -y eza"

[bundles]
kali = ["fzf", "pet"]
`;

describe('runBootstrap (command layer)', () => {
  beforeEach(() => {
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
  });

  describe('--dry-run selection modes', () => {
    it('--all selects every catalog tool in topological order', async () => {
      writeBootstrapToml(SIMPLE_TOML);
      const result = await runBootstrap({ all: true, dryRun: true });
      expect(result.dryRun).toBe(true);
      expect(result.plan?.ordered.map((t) => t.id).sort()).toEqual(['eza', 'fzf', 'pet']);
      // fzf must precede pet (pet requires fzf).
      const order = result.plan!.ordered.map((t) => t.id);
      expect(order.indexOf('fzf')).toBeLessThan(order.indexOf('pet'));
      expect(result.counts).toBeNull();
    });

    it('--tools respects the explicit list and auto-includes deps', async () => {
      writeBootstrapToml(SIMPLE_TOML);
      const result = await runBootstrap({ tools: 'pet', dryRun: true });
      expect(result.plan?.ordered.map((t) => t.id)).toEqual(['fzf', 'pet']);
      expect(result.plan?.implied).toEqual(['fzf']);
    });

    it('--tools accepts both comma- and space-separated lists', async () => {
      writeBootstrapToml(SIMPLE_TOML);
      const byComma = await runBootstrap({ tools: 'fzf,eza', dryRun: true });
      const bySpace = await runBootstrap({ tools: 'fzf eza', dryRun: true });
      const byMixed = await runBootstrap({ tools: 'fzf, eza', dryRun: true });
      expect(byComma.plan?.ordered.map((t) => t.id).sort()).toEqual(['eza', 'fzf']);
      expect(bySpace.plan?.ordered.map((t) => t.id).sort()).toEqual(['eza', 'fzf']);
      expect(byMixed.plan?.ordered.map((t) => t.id).sort()).toEqual(['eza', 'fzf']);
    });

    it('--bundle expands to the bundle members', async () => {
      writeBootstrapToml(SIMPLE_TOML);
      const result = await runBootstrap({ bundle: 'kali', dryRun: true });
      expect(result.plan?.ordered.map((t) => t.id).sort()).toEqual(['fzf', 'pet']);
    });

    it('unknown --bundle throws BootstrapError naming available bundles', async () => {
      writeBootstrapToml(SIMPLE_TOML);
      try {
        await runBootstrap({ bundle: 'nonexistent', dryRun: true });
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BootstrapError);
        expect((err as BootstrapError).message).toContain('nonexistent');
        expect((err as BootstrapError).suggestions?.[0]).toContain('kali');
      }
    });

    it('unknown tool id in --tools is captured in plan.unknown (not fatal)', async () => {
      writeBootstrapToml(SIMPLE_TOML);
      const result = await runBootstrap({
        tools: 'fzf,ghost,mystery',
        dryRun: true,
      });
      expect(result.plan?.ordered.map((t) => t.id)).toEqual(['fzf']);
      expect(result.plan?.unknown.sort()).toEqual(['ghost', 'mystery']);
    });
  });

  describe('error paths', () => {
    it('throws BootstrapError when bootstrap.toml is missing', async () => {
      // No file written to TEST_TUCK_DIR.
      await expect(
        runBootstrap({ all: true, dryRun: true })
      ).rejects.toBeInstanceOf(BootstrapError);
    });

    it('--file overrides the default location', async () => {
      const customPath = '/test-home/custom/path/bootstrap.toml';
      vol.mkdirSync('/test-home/custom/path', { recursive: true });
      vol.writeFileSync(customPath, SIMPLE_TOML);
      const result = await runBootstrap({ file: customPath, all: true, dryRun: true });
      expect(result.plan?.ordered).toHaveLength(3);
    });

    it('empty catalog exits cleanly without error', async () => {
      writeBootstrapToml(''); // empty file parses to { tool: [], bundles: {}, registry: {...} }
      const result = await runBootstrap({ all: true, dryRun: true });
      expect(result).toEqual({ plan: null, counts: null, dryRun: false });
    });

    it('throws NonInteractivePromptError in non-interactive mode without a selector', async () => {
      writeBootstrapToml(SIMPLE_TOML);
      // Test env is non-TTY (isInteractive() returns false by default under vitest).
      // No --all/--bundle/--tools → picker would be invoked → guard fires.
      await expect(runBootstrap({ dryRun: true })).rejects.toBeInstanceOf(
        NonInteractivePromptError
      );
    });

    it('surfaces TOML syntax errors with line information', async () => {
      writeBootstrapToml(`
[[tool]]
id = "pet"
description = "bad missing quote
install = "x"
`);
      try {
        await runBootstrap({ all: true, dryRun: true });
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BootstrapError);
        expect((err as Error).message).toMatch(/line \d+/);
      }
    });
  });
});
