import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolDefinition } from '../../src/schemas/bootstrap.schema.js';

const loadBootstrapConfigMock = vi.fn();
const pathExistsMock = vi.fn();
const readFileMock = vi.fn();

vi.mock('../../src/lib/bootstrap/parser.js', () => ({
  loadBootstrapConfig: loadBootstrapConfigMock,
}));

vi.mock('fs/promises', () => ({
  readFile: readFileMock,
}));

vi.mock('../../src/lib/paths.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/paths.js')>(
    '../../src/lib/paths.js'
  );
  return {
    ...actual,
    pathExists: pathExistsMock,
  };
});

const importFindUncovered = async () =>
  (await import('../../src/lib/bootstrap/uncoveredReferences.js'))
    .findUncoveredReferences;

const userToolsConfig = (tools: ToolDefinition[]) => ({
  tool: tools,
  bundles: {},
  registry: { disabled: [] },
});

const makeTool = (overrides: Partial<ToolDefinition>): ToolDefinition => ({
  id: 'fixture',
  description: 'x',
  requires: [],
  install: 'true',
  detect: { paths: [], rcReferences: [] },
  associatedConfig: [],
  ...overrides,
});

describe('findUncoveredReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathExistsMock.mockResolvedValue(true);
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    loadBootstrapConfigMock.mockResolvedValue(userToolsConfig([]));
  });

  it('returns empty when no paths are restored', async () => {
    const findUncoveredReferences = await importFindUncovered();
    expect(await findUncoveredReferences('/tuck', [])).toEqual([]);
  });

  it('returns empty when bootstrap.toml is absent and no well-known references match', async () => {
    pathExistsMock.mockResolvedValue(false);
    readFileMock.mockResolvedValueOnce('# nothing relevant');
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', [
      '/test-home/.config/random/file.toml',
    ]);
    expect(result).toEqual([]);
  });

  it('flags fzf as uncovered when ~/.zshrc references it AND no user tool covers it', async () => {
    readFileMock.mockResolvedValueOnce('eval "$(fzf --zsh)"');
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    expect(result.map((u) => u.id)).toContain('fzf');
  });

  it('considers a well-known tool covered when the user has a tool block with the same id', async () => {
    loadBootstrapConfigMock.mockResolvedValue(
      userToolsConfig([makeTool({ id: 'fzf' })])
    );
    readFileMock.mockResolvedValueOnce('eval "$(fzf --zsh)"');
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    expect(result.map((u) => u.id)).not.toContain('fzf');
  });

  it('considers covered when a user tool installs the binary via brew (e.g. brew-cli-utils)', async () => {
    // Mirrors stanrc85/dotfiles bootstrap.toml's `brew-cli-utils` shape:
    // one tool block whose install runs `brew install fzf yazi neovim ...`.
    // Liberal coverage: word-boundary match against the binary or formula
    // name in the install command.
    loadBootstrapConfigMock.mockResolvedValue(
      userToolsConfig([
        makeTool({
          id: 'brew-cli-utils',
          install: 'brew install fzf yazi neovim bat fd ripgrep eza',
        }),
      ])
    );
    readFileMock.mockResolvedValueOnce('eval "$(fzf --zsh)"');
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    expect(result.map((u) => u.id)).not.toContain('fzf');
  });

  it('considers covered when a user tool maps the brew formula name (ripgrep → rg)', async () => {
    // ripgrep's binary is `rg` but the brew formula is `ripgrep`. Coverage
    // logic checks both, so a user installing via `brew install ripgrep`
    // covers references to the binary in the rc file.
    loadBootstrapConfigMock.mockResolvedValue(
      userToolsConfig([
        makeTool({
          id: 'cli-bundle',
          install: 'brew install ripgrep',
        }),
      ])
    );
    readFileMock.mockResolvedValueOnce('alias gr="rg --color=auto"');
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    expect(result.map((u) => u.id)).not.toContain('ripgrep');
  });

  it('considers covered when a user tool lists the well-known id in detect.rcReferences', async () => {
    loadBootstrapConfigMock.mockResolvedValue(
      userToolsConfig([
        makeTool({
          id: 'shell-bundle',
          install: 'true',
          detect: { paths: [], rcReferences: ['fzf'] },
        }),
      ])
    );
    readFileMock.mockResolvedValueOnce('eval "$(fzf --zsh)"');
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    expect(result.map((u) => u.id)).not.toContain('fzf');
  });

  it('flags neovim-plugins as installType=manual when ~/.config/nvim/lua/ is restored without a covering tool', async () => {
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', [
      '/test-home/.config/nvim/lua/plugins/init.lua',
    ]);
    const np = result.find((u) => u.id === 'neovim-plugins');
    expect(np).toBeDefined();
    expect(np?.installType).toBe('manual');
    expect(np?.brewFormula).toBe('');
  });

  it('returns the brew formula and installType=brew for a brewable uncovered tool', async () => {
    readFileMock.mockResolvedValueOnce('eval "$(fzf --zsh)"');
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    const fzf = result.find((u) => u.id === 'fzf');
    expect(fzf?.installType).toBe('brew');
    expect(fzf?.brewFormula).toBe('fzf');
  });

  it('only scans rc-shaped paths for content (ignores .toml mentions)', async () => {
    // Token "fzf" inside a .toml file shouldn't trigger a match. Only
    // shell-rc-shaped basenames or extensions are scanned.
    readFileMock.mockResolvedValue('[fzf] enabled = true');
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', [
      '/test-home/.config/random/foo.toml',
    ]);
    expect(result.map((u) => u.id)).not.toContain('fzf');
  });
});
