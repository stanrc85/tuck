import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addToBundle,
  createBundle,
  deleteBundle,
  listBundles,
  removeFromBundle,
  showBundle,
} from '../../src/lib/bootstrap/bundleOps.js';
import { BootstrapError } from '../../src/errors.js';
import type {
  BootstrapConfig,
  ToolDefinition,
} from '../../src/schemas/bootstrap.schema.js';

const { runCheckMock, detectToolMock } = vi.hoisted(() => ({
  runCheckMock: vi.fn(),
  detectToolMock: vi.fn(),
}));

vi.mock('../../src/lib/bootstrap/runner.js', () => ({
  runCheck: runCheckMock,
}));

vi.mock('../../src/lib/bootstrap/detect.js', () => ({
  detectTool: detectToolMock,
}));

const makeTool = (id: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id,
  description: `${id} description`,
  requires: [],
  install: 'true',
  detect: { paths: [], rcReferences: [] },
  associatedConfig: [],
  ...overrides,
});

const makeConfig = (bundles: Record<string, string[]> = {}): BootstrapConfig => ({
  tool: [],
  bundles,
  registry: { disabled: [] },
});

describe('listBundles', () => {
  it('returns sorted bundles with member counts', () => {
    const config = makeConfig({
      kali: ['fzf', 'neovim'],
      minimal: ['fzf'],
      extra: [],
    });
    expect(listBundles(config)).toEqual([
      { name: 'extra', memberCount: 0 },
      { name: 'kali', memberCount: 2 },
      { name: 'minimal', memberCount: 1 },
    ]);
  });

  it('returns empty array when no bundles defined', () => {
    expect(listBundles(makeConfig())).toEqual([]);
  });
});

describe('showBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when the bundle does not exist', async () => {
    const config = makeConfig({ kali: ['fzf'] });
    await expect(showBundle(config, [], 'nope')).rejects.toBeInstanceOf(BootstrapError);
  });

  it('tags members as installed / detected / missing / unknown', async () => {
    const catalog = [makeTool('fzf'), makeTool('nvim'), makeTool('yazi')];
    const config = makeConfig({ kali: ['fzf', 'nvim', 'yazi', 'ghost'] });

    runCheckMock.mockImplementation(async (tool: ToolDefinition) => tool.id === 'fzf');
    detectToolMock.mockImplementation(async (tool: ToolDefinition) => ({
      detected: tool.id === 'nvim',
      reasons: [],
    }));

    const details = await showBundle(config, catalog, 'kali');

    const byId = Object.fromEntries(details.members.map((m) => [m.id, m.status]));
    expect(byId).toEqual({
      fzf: 'installed',
      nvim: 'detected',
      yazi: 'missing',
      ghost: 'unknown',
    });
  });

  it('tolerates runCheck throwing (treats tool as missing)', async () => {
    const catalog = [makeTool('fzf')];
    const config = makeConfig({ k: ['fzf'] });
    runCheckMock.mockRejectedValue(new Error('bash not found'));
    detectToolMock.mockResolvedValue({ detected: false, reasons: [] });

    const details = await showBundle(config, catalog, 'k');
    expect(details.members[0].status).toBe('missing');
  });
});

describe('createBundle', () => {
  it('adds a new bundle', () => {
    const config = makeConfig();
    const catalog = [makeTool('fzf'), makeTool('eza')];
    const updated = createBundle(config, catalog, 'new', ['fzf', 'eza']);
    expect(updated.bundles.new).toEqual(['fzf', 'eza']);
  });

  it('de-duplicates repeated members', () => {
    const config = makeConfig();
    const catalog = [makeTool('fzf')];
    const updated = createBundle(config, catalog, 'dup', ['fzf', 'fzf']);
    expect(updated.bundles.dup).toEqual(['fzf']);
  });

  it('rejects empty member list', () => {
    expect(() => createBundle(makeConfig(), [], 'empty', [])).toThrow(BootstrapError);
  });

  it('rejects unknown tool ids with a helpful message', () => {
    const catalog = [makeTool('fzf')];
    try {
      createBundle(makeConfig(), catalog, 'n', ['fzf', 'ghost']);
      throw new Error('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BootstrapError);
      expect((error as BootstrapError).message).toContain('ghost');
    }
  });

  it('hints v2→v3 migration when an unknown id matches a former built-in', () => {
    // `bat` was a v2 built-in, removed in v3. If a user lists it as a bundle
    // member without defining a `[[tool]]` block, they should see a hint
    // explaining the migration — not just "Available ids: my-tool".
    const catalog = [makeTool('my-tool')];
    try {
      createBundle(makeConfig(), catalog, 'b', ['bat']);
      throw new Error('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BootstrapError);
      const suggestions = (error as BootstrapError).suggestions ?? [];
      const joined = suggestions.join('\n');
      expect(joined).toMatch(/built-in registry tool pre-v3/);
      expect(joined).toContain('bat');
    }
  });

  it('rejects duplicate bundle names unless overwrite is true', () => {
    const config = makeConfig({ kali: ['fzf'] });
    const catalog = [makeTool('fzf'), makeTool('eza')];

    expect(() => createBundle(config, catalog, 'kali', ['eza'])).toThrow(BootstrapError);
    const updated = createBundle(config, catalog, 'kali', ['eza'], { overwrite: true });
    expect(updated.bundles.kali).toEqual(['eza']);
  });
});

describe('addToBundle', () => {
  it('appends a new member', () => {
    const config = makeConfig({ k: ['fzf'] });
    const catalog = [makeTool('fzf'), makeTool('eza')];
    const result = addToBundle(config, catalog, 'k', 'eza');
    expect(result.alreadyMember).toBe(false);
    expect(result.config.bundles.k).toEqual(['fzf', 'eza']);
  });

  it('is a no-op when the tool is already a member', () => {
    const config = makeConfig({ k: ['fzf'] });
    const catalog = [makeTool('fzf')];
    const result = addToBundle(config, catalog, 'k', 'fzf');
    expect(result.alreadyMember).toBe(true);
    expect(result.config.bundles.k).toEqual(['fzf']);
  });

  it('throws on unknown bundle', () => {
    const catalog = [makeTool('fzf')];
    expect(() => addToBundle(makeConfig(), catalog, 'nope', 'fzf')).toThrow(BootstrapError);
  });

  it('throws on unknown tool id', () => {
    const config = makeConfig({ k: ['fzf'] });
    const catalog = [makeTool('fzf')];
    expect(() => addToBundle(config, catalog, 'k', 'ghost')).toThrow(BootstrapError);
  });
});

describe('removeFromBundle', () => {
  it('drops the member', () => {
    const config = makeConfig({ k: ['fzf', 'eza'] });
    const result = removeFromBundle(config, 'k', 'eza');
    expect(result.wasMember).toBe(true);
    expect(result.config.bundles.k).toEqual(['fzf']);
  });

  it('is a no-op when the tool is not a member', () => {
    const config = makeConfig({ k: ['fzf'] });
    const result = removeFromBundle(config, 'k', 'eza');
    expect(result.wasMember).toBe(false);
    expect(result.config.bundles.k).toEqual(['fzf']);
  });

  it('throws on unknown bundle', () => {
    expect(() => removeFromBundle(makeConfig(), 'nope', 'fzf')).toThrow(BootstrapError);
  });
});

describe('deleteBundle', () => {
  it('removes the bundle', () => {
    const config = makeConfig({ k: ['fzf'], other: ['eza'] });
    const updated = deleteBundle(config, 'k');
    expect(updated.bundles).toEqual({ other: ['eza'] });
  });

  it('throws on unknown bundle', () => {
    expect(() => deleteBundle(makeConfig(), 'nope')).toThrow(BootstrapError);
  });
});
