import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolDefinition } from '../../src/schemas/bootstrap.schema.js';

const runCheckMock = vi.fn();
const loadBootstrapConfigMock = vi.fn();
const pathExistsMock = vi.fn();

vi.mock('../../src/lib/bootstrap/runner.js', () => ({
  runCheck: runCheckMock,
}));

vi.mock('../../src/lib/bootstrap/parser.js', () => ({
  loadBootstrapConfig: loadBootstrapConfigMock,
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
    detect: { paths: [], rcReferences: [] },
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

  it('ignores tools with no associatedConfig even if their check fails', async () => {
    runCheckMock.mockResolvedValue(false);
    const findMissingDeps = await importFindMissingDeps();

    const result = await findMissingDeps('/tuck', ['/test-home/.zshrc']);
    // eza has [] associatedConfig so it should never be a candidate.
    expect(result).toEqual([]);
    expect(runCheckMock).not.toHaveBeenCalled();
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
