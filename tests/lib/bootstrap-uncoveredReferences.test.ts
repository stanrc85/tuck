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

const userToolsConfig = (
  tools: ToolDefinition[],
  overrides: { ignoreUncovered?: string[] } = {}
) => ({
  tool: tools,
  bundles: {},
  registry: { disabled: [] },
  restore: { ignoreUncovered: overrides.ignoreUncovered ?? [] },
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

  it('detects modern shell-ecosystem tools beyond the legacy 12 (zoxide, starship, mise, …)', async () => {
    // Smoke test for the post-v2 well-known additions. zoxide's rcReferences
    // is plain `zoxide`; starship's is `starship`; mise's is `mise activate`.
    readFileMock.mockResolvedValueOnce(`
eval "$(zoxide init zsh)"
eval "$(starship init zsh)"
eval "$(mise activate zsh)"
`);
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    const ids = result.map((u) => u.id);
    expect(ids).toContain('zoxide');
    expect(ids).toContain('starship');
    expect(ids).toContain('mise');
    // All three should be brew-installable.
    for (const u of result.filter((u) => ['zoxide', 'starship', 'mise'].includes(u.id))) {
      expect(u.installType).toBe('brew');
      expect(u.brewFormula).toBeTruthy();
    }
  });

  it('does NOT false-flag mise on the substring "promise"', async () => {
    // mise's rcReferences is `mise activate` / `mise/shims` (not plain `mise`)
    // specifically to avoid promise/compromise substring matches.
    readFileMock.mockResolvedValueOnce(`
# I promise this isn't a mise reference
alias verify="echo no compromise"
`);
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    expect(result.map((u) => u.id)).not.toContain('mise');
  });

  it('considers covered when a user tool mentions the binary in its check command', async () => {
    // Real pattern: a user's tool block whose install handles a bundle of
    // CLIs but whose check probes for one specific binary. Coverage logic
    // should accept the binary mention from check too, not just install.
    loadBootstrapConfigMock.mockResolvedValue(
      userToolsConfig([
        makeTool({
          id: 'shell-bundle',
          install: 'true',
          check: 'command -v fzf >/dev/null 2>&1',
        }),
      ])
    );
    readFileMock.mockResolvedValueOnce('eval "$(fzf --zsh)"');
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    expect(result.map((u) => u.id)).not.toContain('fzf');
  });

  it('considers covered when user.detect.paths overlap with the well-known paths', async () => {
    // Path-claim overlap: a user-defined "config-only" tool block can claim
    // ownership of a directory by listing it in detect.paths, even without
    // any install command that would otherwise signal coverage.
    loadBootstrapConfigMock.mockResolvedValue(
      userToolsConfig([
        makeTool({
          id: 'nvim-config',
          install: 'true',
          detect: { paths: ['~/.config/nvim/**'], rcReferences: [] },
        }),
      ])
    );
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', [
      '/test-home/.config/nvim/init.lua',
    ]);
    expect(result.map((u) => u.id)).not.toContain('neovim');
  });

  it('does NOT false-flag bat on the substring "combat" in restored rc content', async () => {
    // Word-boundary upgrade for rcReferences: pre-fix the matcher used
    // .includes() so `bat` matched `combat`. Post-fix uses \bbat\b.
    readFileMock.mockResolvedValueOnce('# combat-ready alias setup\n');
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    expect(result.map((u) => u.id)).not.toContain('bat');
  });

  it('detects tools with empty rcReferences via path-only matching (gh)', async () => {
    // gh has rcReferences=[] (token too short for safe content scan) and
    // relies on ~/.config/gh/** paths. Restore that path → uncovered warning.
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', [
      '/test-home/.config/gh/config.yml',
    ]);
    const ids = result.map((u) => u.id);
    expect(ids).toContain('gh');
  });

  it('handles manual-install tools with empty binary and brewFormula without crashing', async () => {
    // zimfw has binary='' and brewFormula='' (manual installType).
    // The coverage check's empty-string short-circuits should keep these
    // safe — no crash, just falls through to id/rcReferences checks.
    readFileMock.mockResolvedValueOnce('zimfw config goes here');
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    const zimfw = result.find((u) => u.id === 'zimfw');
    expect(zimfw).toBeDefined();
    expect(zimfw?.installType).toBe('manual');
    expect(zimfw?.brewFormula).toBe('');
  });

  it('suppresses ids listed in [restore] ignoreUncovered from the warning', async () => {
    // Real-world fit: starship is referenced in the user's .zshrc but they
    // install it via a one-off (not bootstrap), so they don't want tuck
    // flagging it on every restore. Listing it in ignoreUncovered hides
    // it without faking a user tool block.
    loadBootstrapConfigMock.mockResolvedValue(
      userToolsConfig([], { ignoreUncovered: ['starship', 'zimfw'] })
    );
    readFileMock.mockResolvedValueOnce(`
eval "$(starship init zsh)"
zimfw upgrade
eval "$(zoxide init zsh)"
`);
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    const ids = result.map((u) => u.id);
    expect(ids).not.toContain('starship');
    expect(ids).not.toContain('zimfw');
    // zoxide is NOT in the ignore list, so it still surfaces.
    expect(ids).toContain('zoxide');
  });

  it('treats unknown ignoreUncovered ids as no-ops (not errors)', async () => {
    // Users may list ids that are not (yet) in WELL_KNOWN_TOOLS — typo, or
    // a tool that lived in the table at some point and was removed. The
    // unknown id should silently no-op so a stale config doesn't break
    // restore.
    loadBootstrapConfigMock.mockResolvedValue(
      userToolsConfig([], { ignoreUncovered: ['exa', 'never-existed'] })
    );
    readFileMock.mockResolvedValueOnce('eval "$(zoxide init zsh)"');
    const findUncoveredReferences = await importFindUncovered();

    const result = await findUncoveredReferences('/tuck', ['/test-home/.zshrc']);
    expect(result.map((u) => u.id)).toContain('zoxide');
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
