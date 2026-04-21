import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolDefinition } from '../../src/schemas/bootstrap.schema.js';

const runCheckMock = vi.fn();
const loadBootstrapConfigMock = vi.fn();
const pathExistsMock = vi.fn();
const readFileMock = vi.fn();

vi.mock('../../src/lib/bootstrap/runner.js', () => ({
  runCheck: runCheckMock,
}));

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

const BUILT_INS_STUB: ToolDefinition[] = [
  {
    id: 'neovim',
    description: 'hyperextensible Vim-based editor',
    requires: [],
    check: 'command -v nvim',
    install: 'true',
    detect: { paths: [], rcReferences: [] },
    associatedConfig: ['~/.config/nvim/**'],
  },
  {
    id: 'yazi',
    description: 'terminal file manager',
    requires: [],
    check: 'command -v yazi',
    install: 'true',
    detect: { paths: [], rcReferences: [] },
    associatedConfig: ['~/.config/yazi/**'],
  },
  {
    id: 'eza',
    description: 'modern ls',
    requires: [],
    check: 'command -v eza',
    install: 'true',
    detect: { paths: [], rcReferences: ['eza'] },
    associatedConfig: [],
  },
];

vi.mock('../../src/lib/bootstrap/registry/index.js', () => ({
  BUILT_IN_TOOLS: BUILT_INS_STUB,
  mergeWithRegistry: (config: { tool: ToolDefinition[] }) => [
    ...config.tool,
    ...BUILT_INS_STUB,
  ],
}));

const importFindMissingDeps = async () =>
  (await import('../../src/lib/bootstrap/missingDeps.js')).findMissingDeps;

describe('findMissingDeps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathExistsMock.mockResolvedValue(false);
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    loadBootstrapConfigMock.mockResolvedValue({
      tool: [],
      bundles: {},
      registry: { disabled: [] },
    });
  });

  it('returns empty when restored paths is empty', async () => {
    const findMissingDeps = await importFindMissingDeps();
    const result = await findMissingDeps('/tuck', []);
    expect(result).toEqual([]);
    expect(runCheckMock).not.toHaveBeenCalled();
  });

  it('flags a tool when its glob matches a restored file AND the check fails', async () => {
    runCheckMock.mockResolvedValue(false);
    const findMissingDeps = await importFindMissingDeps();

    const result = await findMissingDeps('/tuck', ['/test-home/.config/nvim/init.lua']);

    expect(result).toEqual([
      { id: 'neovim', description: 'hyperextensible Vim-based editor' },
    ]);
  });

  it('does NOT flag a tool whose check passes (already installed)', async () => {
    runCheckMock.mockResolvedValue(true);
    const findMissingDeps = await importFindMissingDeps();

    const result = await findMissingDeps('/tuck', ['/test-home/.config/nvim/init.lua']);
    expect(result).toEqual([]);
  });

  it('ignores tools with no associatedConfig when no restored rc content matches their rcReferences', async () => {
    runCheckMock.mockResolvedValue(false);
    readFileMock.mockResolvedValueOnce('# empty rc — no tool references here');
    const findMissingDeps = await importFindMissingDeps();

    const result = await findMissingDeps('/tuck', ['/test-home/.zshrc']);
    // eza has [] associatedConfig and content has no "eza" string → no match.
    expect(result).toEqual([]);
    expect(runCheckMock).not.toHaveBeenCalled();
  });

  it('flags a tool via rcReferences when its keyword appears in a restored shell-rc file', async () => {
    // Simulates the XDG layout case: user's aliases.zsh contains
    // `alias ls=eza` but eza has no associatedConfig path to match. The
    // content scan should find "eza" and flag the tool as a candidate.
    runCheckMock.mockResolvedValue(false);
    readFileMock.mockResolvedValueOnce('alias ls="eza --git"');
    const findMissingDeps = await importFindMissingDeps();

    const result = await findMissingDeps('/tuck', ['/test-home/.config/zsh/aliases.zsh']);
    expect(result.map((d) => d.id)).toContain('eza');
  });

  it('does NOT flag via rcReferences when the tool is already installed', async () => {
    runCheckMock.mockResolvedValue(true);
    readFileMock.mockResolvedValueOnce('alias ls=eza');
    const findMissingDeps = await importFindMissingDeps();

    const result = await findMissingDeps('/tuck', ['/test-home/.config/zsh/aliases.zsh']);
    expect(result).toEqual([]);
  });

  it('limits content scanning to shell-rc-like file paths (ignores unrelated restored files)', async () => {
    // Even if a non-shell file contains the literal keyword "eza"
    // (e.g. a config.toml with a path that happens to include it),
    // don't scan it. Keeps false positives out of the prompt.
    runCheckMock.mockResolvedValue(false);
    readFileMock.mockResolvedValue('[eza] enabled = true');
    const findMissingDeps = await importFindMissingDeps();

    const result = await findMissingDeps('/tuck', [
      '/test-home/.config/pet/config.toml',
      '/test-home/.config/yazi/theme.toml',
    ]);
    // yazi has associatedConfig so still flagged through its glob — but
    // eza shouldn't be in the result since no scanned rc had a match.
    expect(result.map((d) => d.id)).toContain('yazi');
    expect(result.map((d) => d.id)).not.toContain('eza');
  });

  it('tolerates unreadable rc files (permission / transient I/O) — returns false without crashing', async () => {
    runCheckMock.mockResolvedValue(false);
    readFileMock.mockRejectedValue(new Error('EACCES'));
    const findMissingDeps = await importFindMissingDeps();

    const result = await findMissingDeps('/tuck', ['/test-home/.zshrc']);
    expect(result).toEqual([]);
  });

  it('flags multiple tools when multiple configs are restored', async () => {
    runCheckMock.mockResolvedValue(false);
    const findMissingDeps = await importFindMissingDeps();

    const result = await findMissingDeps('/tuck', [
      '/test-home/.config/nvim/init.lua',
      '/test-home/.config/yazi/keymap.toml',
    ]);

    expect(result.map((d) => d.id).sort()).toEqual(['neovim', 'yazi']);
  });

  it('treats a missing bootstrap.toml as empty user catalog (registry still active)', async () => {
    pathExistsMock.mockResolvedValue(false);
    runCheckMock.mockResolvedValue(false);

    const findMissingDeps = await importFindMissingDeps();
    const result = await findMissingDeps('/tuck', ['/test-home/.config/nvim/init.lua']);

    expect(result.map((d) => d.id)).toEqual(['neovim']);
    expect(loadBootstrapConfigMock).not.toHaveBeenCalled();
  });

  it('loads the user catalog when bootstrap.toml exists', async () => {
    pathExistsMock.mockResolvedValue(true);
    runCheckMock.mockResolvedValue(false);
    loadBootstrapConfigMock.mockResolvedValue({
      tool: [
        {
          id: 'my-tool',
          description: 'user tool',
          requires: [],
          check: 'false',
          install: 'true',
          detect: { paths: [], rcReferences: [] },
          associatedConfig: ['~/.zshrc'],
        },
      ],
      bundles: {},
      registry: { disabled: [] },
    });

    const findMissingDeps = await importFindMissingDeps();
    const result = await findMissingDeps('/tuck', ['/test-home/.zshrc']);

    expect(result.map((d) => d.id)).toEqual(['my-tool']);
    expect(loadBootstrapConfigMock).toHaveBeenCalled();
  });

  it('swallows check-script errors and treats the tool as missing', async () => {
    runCheckMock.mockRejectedValue(new Error('bash not found'));
    const findMissingDeps = await importFindMissingDeps();

    const result = await findMissingDeps('/tuck', ['/test-home/.config/nvim/init.lua']);
    expect(result.map((d) => d.id)).toEqual(['neovim']);
  });
});
