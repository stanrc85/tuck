import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join, sep } from 'path';
import { NotInitializedError, NonInteractivePromptError } from '../../src/errors.js';
import { mockColors, mockFormatCount, mockOutro } from '../utils/uiMocks.js';

const isInteractiveMock = vi.fn(() => true);
const multiselectMock = vi.fn();
const confirmMock = vi.fn();
const promptsLogWarningMock = vi.fn();
const promptsLogInfoMock = vi.fn();
const promptsLogSuccessMock = vi.fn();
const promptsLogMessageMock = vi.fn();
const findMissingDepsMock = vi.fn();
const runBootstrapMock = vi.fn();
const loadBootstrapConfigMock = vi.fn();

const loadManifestMock = vi.fn();
const getAllTrackedFilesMock = vi.fn();
const getTrackedFileBySourceMock = vi.fn();
const getAllGroupsMock = vi.fn();
const loadConfigMock = vi.fn();
const saveLocalConfigMock = vi.fn();
const copyFileOrDirMock = vi.fn();
const createSymlinkMock = vi.fn();
const runPreRestoreHookMock = vi.fn();
const runPostRestoreHookMock = vi.fn();
const restoreSecretsMock = vi.fn();
const getSecretCountMock = vi.fn();
const pathExistsMock = vi.fn();
const validateSafeSourcePathMock = vi.fn();
const validateSafeManifestDestinationMock = vi.fn();
const validatePathWithinRootMock = vi.fn();

vi.mock('../../src/ui/index.js', () => ({
  prompts: {
    intro: vi.fn(),
    outro: mockOutro(),
    multiselect: multiselectMock,
    select: vi.fn(),
    confirm: confirmMock,
    cancel: vi.fn(),
    note: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: '' })),
    log: {
      info: promptsLogInfoMock,
      success: promptsLogSuccessMock,
      warning: promptsLogWarningMock,
      error: vi.fn(),
      message: promptsLogMessageMock,
    },
  },
  logger: {
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    heading: vi.fn(),
    blank: vi.fn(),
    file: vi.fn(),
    dim: vi.fn(),
  },
  withSpinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  isInteractive: isInteractiveMock,
  formatCount: mockFormatCount,
  colors: mockColors(),
}));

vi.mock('../../src/lib/bootstrap/missingDeps.js', () => ({
  findMissingDeps: findMissingDepsMock,
}));

vi.mock('../../src/lib/bootstrap/parser.js', () => ({
  loadBootstrapConfig: loadBootstrapConfigMock,
}));

vi.mock('../../src/commands/bootstrap.js', () => ({
  runBootstrap: runBootstrapMock,
}));

vi.mock('../../src/ui/theme.js', () => ({
  colors: {
    yellow: (x: string) => x,
    dim: (x: string) => x,
    brand: (x: string) => x,
    bold: (x: string) => x,
    warning: (x: string) => x,
    error: (x: string) => x,
    success: (x: string) => x,
    muted: (x: string) => x,
  },
}));

vi.mock('../../src/lib/paths.js', () => ({
  getTuckDir: vi.fn(() => '/test-home/.tuck'),
  expandPath: vi.fn((p: string) => p.replace(/^~\//, '/test-home/')),
  pathExists: pathExistsMock,
  collapsePath: vi.fn((p: string) => p),
  validateSafeSourcePath: validateSafeSourcePathMock,
  validateSafeManifestDestination: validateSafeManifestDestinationMock,
  validatePathWithinRoot: validatePathWithinRootMock,
}));

vi.mock('../../src/lib/manifest.js', () => ({
  loadManifest: loadManifestMock,
  getAllTrackedFiles: getAllTrackedFilesMock,
  getTrackedFileBySource: getTrackedFileBySourceMock,
  assertMigrated: vi.fn(),
  getAllGroups: getAllGroupsMock,
  fileMatchesGroups: (
    _file: unknown,
    groups: string[] | undefined
  ): boolean => !groups || groups.length === 0,
}));

vi.mock('../../src/lib/config.js', () => ({
  loadConfig: loadConfigMock,
  saveLocalConfig: saveLocalConfigMock,
}));

vi.mock('../../src/lib/files.js', () => ({
  copyFileOrDir: copyFileOrDirMock,
  createSymlink: createSymlinkMock,
}));

vi.mock('../../src/lib/hooks.js', () => ({
  runPreRestoreHook: runPreRestoreHookMock,
  runPostRestoreHook: runPostRestoreHookMock,
}));

const createSnapshotMock = vi.fn();
const pruneSnapshotsMock = vi.fn();
vi.mock('../../src/lib/timemachine.js', () => ({
  createSnapshot: createSnapshotMock,
  pruneSnapshotsFromConfig: pruneSnapshotsMock,
}));

vi.mock('../../src/lib/secrets/index.js', () => ({
  restoreFiles: restoreSecretsMock,
  getSecretCount: getSecretCountMock,
}));

describe('restore command behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isInteractiveMock.mockReturnValue(true);

    loadManifestMock.mockResolvedValue({ files: {} });
    getAllTrackedFilesMock.mockResolvedValue({});
    getTrackedFileBySourceMock.mockResolvedValue(null);
    loadConfigMock.mockResolvedValue({
      files: {
        strategy: 'copy',
        backupOnRestore: true,
      },
    });
    // Default: single-group repo so the TASK-047 assignment prompt is a no-op
    // in tests that don't care about it. Tests override with mockResolvedValueOnce.
    getAllGroupsMock.mockResolvedValue(['default']);
    saveLocalConfigMock.mockResolvedValue(undefined);
    copyFileOrDirMock.mockResolvedValue(undefined);
    createSymlinkMock.mockResolvedValue(undefined);
    runPreRestoreHookMock.mockResolvedValue(undefined);
    runPostRestoreHookMock.mockResolvedValue(undefined);
    getSecretCountMock.mockResolvedValue(0);
    restoreSecretsMock.mockResolvedValue({ totalRestored: 0, allUnresolved: [] });
    pathExistsMock.mockResolvedValue(true);
    validateSafeSourcePathMock.mockImplementation(() => {});
    validateSafeManifestDestinationMock.mockImplementation(() => {});
    validatePathWithinRootMock.mockImplementation(() => {});
    // Default: no missing deps so the TASK-048 prompt is a no-op in tests
    // that don't care about it. Tests override per-case.
    findMissingDepsMock.mockResolvedValue([]);
    runBootstrapMock.mockResolvedValue({ plan: null, counts: null, dryRun: false });
    // Default bootstrap.toml catalog has no bundles — tests that exercise
    // --bootstrap override via mockResolvedValueOnce.
    loadBootstrapConfigMock.mockResolvedValue({
      tool: [],
      bundles: {},
      registry: { disabled: [] },
      restore: { ignoreUncovered: [] },
    });
    confirmMock.mockResolvedValue(true);
  });

  it('throws NotInitializedError when manifest is missing', async () => {
    loadManifestMock.mockRejectedValueOnce(new Error('missing manifest'));
    const { runRestore } = await import('../../src/commands/restore.js');

    await expect(runRestore({ all: true })).rejects.toBeInstanceOf(NotInitializedError);
  });

  it('restores tracked files in all mode', async () => {
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        category: 'shell',
      },
    });

    const { runRestore } = await import('../../src/commands/restore.js');

    await runRestore({ all: true, noHooks: true, noSecrets: true });

    expect(copyFileOrDirMock.mock.calls.length + createSymlinkMock.mock.calls.length).toBe(1);
    expect(validatePathWithinRootMock).toHaveBeenCalledWith(
      join('/test-home/.tuck', 'files', 'shell', 'zshrc'),
      '/test-home/.tuck',
      'restore source'
    );
  });

  it('throws NonInteractivePromptError when interactive restore is requested without a TTY', async () => {
    isInteractiveMock.mockReturnValue(false);
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        category: 'shell',
      },
    });

    const { runRestore } = await import('../../src/commands/restore.js');

    // No --all → falls into interactive path → must fail fast, not hang.
    await expect(runRestore({})).rejects.toBeInstanceOf(NonInteractivePromptError);
    expect(copyFileOrDirMock).not.toHaveBeenCalled();
    expect(createSymlinkMock).not.toHaveBeenCalled();
  });

  it('still runs --all mode when stdout is not a TTY (non-interactive is fine for --all)', async () => {
    isInteractiveMock.mockReturnValue(false);
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        category: 'shell',
      },
    });

    const { runRestore } = await import('../../src/commands/restore.js');

    await runRestore({ all: true, noHooks: true, noSecrets: true });

    expect(copyFileOrDirMock.mock.calls.length + createSymlinkMock.mock.calls.length).toBe(1);
  });

  it('fails fast when manifest destination is unsafe', async () => {
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: '../../outside',
        category: 'shell',
      },
    });
    validateSafeManifestDestinationMock.mockImplementationOnce(() => {
      throw new Error('Unsafe manifest destination detected');
    });

    const { runRestore } = await import('../../src/commands/restore.js');

    await expect(runRestore({ all: true, noHooks: true })).rejects.toThrow(
      'Unsafe manifest destination detected'
    );
    expect(copyFileOrDirMock).not.toHaveBeenCalled();
  });

  it('creates a pre-restore snapshot (kind="restore") of existing host paths before overwriting', async () => {
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        category: 'shell',
      },
    });
    pathExistsMock.mockResolvedValue(true); // both source (exists-at-target) and repo file exist

    const { runRestore } = await import('../../src/commands/restore.js');
    await runRestore({ all: true, noHooks: true, noSecrets: true });

    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
    const [paths, reason, opts] = createSnapshotMock.mock.calls[0];
    expect(paths).toContain('/test-home/.zshrc');
    expect(reason).toMatch(/Pre-restore snapshot/);
    expect(opts).toEqual({ kind: 'restore' });
    expect(pruneSnapshotsMock).toHaveBeenCalledTimes(1);
  });

  it('does not create a snapshot when no tracked host files exist yet', async () => {
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        category: 'shell',
      },
    });
    // Repo file exists (so restore proceeds) but host target does not — nothing
    // worth snapshotting on the destination side. Build the prefix with join+sep
    // so it matches Windows backslash paths in CI.
    const repoFilesPrefix = join('/test-home/.tuck', 'files') + sep;
    pathExistsMock.mockImplementation(async (p: string) =>
      String(p).startsWith(repoFilesPrefix)
    );

    const { runRestore } = await import('../../src/commands/restore.js');
    await runRestore({ all: true, noHooks: true, noSecrets: true });

    expect(createSnapshotMock).not.toHaveBeenCalled();
  });

  it('skips snapshot creation on --dry-run', async () => {
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        category: 'shell',
      },
    });
    pathExistsMock.mockResolvedValue(true);

    const { runRestore } = await import('../../src/commands/restore.js');
    await runRestore({ all: true, noHooks: true, noSecrets: true, dryRun: true });

    expect(createSnapshotMock).not.toHaveBeenCalled();
  });

  // ========== TASK-047 group-assignment prompt ==========

  describe('group-assignment prompt on successful restore', () => {
    const seedMultiGroupManifest = () => {
      getAllTrackedFilesMock.mockResolvedValue({
        zshrc: {
          source: '~/.zshrc',
          destination: 'files/shell/zshrc',
          category: 'shell',
          groups: ['kali'],
        },
      });
    };

    it('prompts + persists when manifest has >1 groups and defaults are empty', async () => {
      seedMultiGroupManifest();
      getAllGroupsMock.mockResolvedValue(['kali', 'kubuntu']);
      loadConfigMock.mockResolvedValue({
        defaultGroups: [],
        files: { strategy: 'copy', backupOnRestore: true },
      });
      multiselectMock.mockResolvedValue(['kali']);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(multiselectMock).toHaveBeenCalledTimes(1);
      expect(saveLocalConfigMock).toHaveBeenCalledWith({ defaultGroups: ['kali'] });
    });

    it('pre-selects options.group values when the user passed -g', async () => {
      // Manifest contains a file in both groups so resolveGroupFilter with -g kali
      // returns the file (the file must match the filter to actually be restored,
      // otherwise runRestore short-circuits with "no files to restore").
      getAllTrackedFilesMock.mockResolvedValue({
        zshrc: {
          source: '~/.zshrc',
          destination: 'files/shell/zshrc',
          category: 'shell',
          groups: ['kali', 'kubuntu'],
        },
      });
      getAllGroupsMock.mockResolvedValue(['kali', 'kubuntu']);
      loadConfigMock.mockResolvedValue({
        defaultGroups: [],
        files: { strategy: 'copy', backupOnRestore: true },
      });
      multiselectMock.mockResolvedValue(['kali']);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true, group: ['kali'] });

      // multiselect is called with (message, options, config) — config has initialValues
      expect(multiselectMock).toHaveBeenCalled();
      const config = multiselectMock.mock.calls[0][2];
      expect(config?.initialValues).toEqual(['kali']);
    });

    it('does NOT prompt on single-group repos', async () => {
      seedMultiGroupManifest();
      getAllGroupsMock.mockResolvedValue(['default']);
      loadConfigMock.mockResolvedValue({
        defaultGroups: [],
        files: { strategy: 'copy', backupOnRestore: true },
      });

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(multiselectMock).not.toHaveBeenCalled();
      expect(saveLocalConfigMock).not.toHaveBeenCalled();
    });

    it('does NOT prompt when defaultGroups is already set', async () => {
      seedMultiGroupManifest();
      getAllGroupsMock.mockResolvedValue(['kali', 'kubuntu']);
      loadConfigMock.mockResolvedValue({
        defaultGroups: ['kali'],
        files: { strategy: 'copy', backupOnRestore: true },
      });

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(multiselectMock).not.toHaveBeenCalled();
      expect(saveLocalConfigMock).not.toHaveBeenCalled();
    });

    it('does NOT prompt on --dry-run (no state changes on a preview)', async () => {
      seedMultiGroupManifest();
      getAllGroupsMock.mockResolvedValue(['kali', 'kubuntu']);
      loadConfigMock.mockResolvedValue({
        defaultGroups: [],
        files: { strategy: 'copy', backupOnRestore: true },
      });

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true, dryRun: true });

      expect(multiselectMock).not.toHaveBeenCalled();
      expect(saveLocalConfigMock).not.toHaveBeenCalled();
    });

    it('emits warning + skips prompt when non-interactive', async () => {
      isInteractiveMock.mockReturnValue(false);
      seedMultiGroupManifest();
      getAllGroupsMock.mockResolvedValue(['kali', 'kubuntu']);
      loadConfigMock.mockResolvedValue({
        defaultGroups: [],
        files: { strategy: 'copy', backupOnRestore: true },
      });

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(multiselectMock).not.toHaveBeenCalled();
      expect(saveLocalConfigMock).not.toHaveBeenCalled();
      expect(promptsLogWarningMock).toHaveBeenCalledWith(
        expect.stringContaining('no default group assigned')
      );
    });

    it('skips persistence when user submits an empty multiselect (Esc / no selection)', async () => {
      seedMultiGroupManifest();
      getAllGroupsMock.mockResolvedValue(['kali', 'kubuntu']);
      loadConfigMock.mockResolvedValue({
        defaultGroups: [],
        files: { strategy: 'copy', backupOnRestore: true },
      });
      multiselectMock.mockResolvedValue([]);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(multiselectMock).toHaveBeenCalledTimes(1);
      expect(saveLocalConfigMock).not.toHaveBeenCalled();
    });
  });

  // ========== TASK-048 missing-deps prompt ==========

  describe('missing-deps prompt on successful restore', () => {
    const seedSingleFileManifest = () => {
      getAllTrackedFilesMock.mockResolvedValue({
        'nvim-init': {
          source: '~/.config/nvim/init.lua',
          destination: 'files/nvim/init.lua',
          category: 'editor',
          groups: ['default'],
        },
      });
    };

    it('does NOT prompt on --dry-run', async () => {
      seedSingleFileManifest();
      findMissingDepsMock.mockResolvedValue([{ id: 'neovim', description: 'nvim' }]);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true, dryRun: true });

      expect(findMissingDepsMock).not.toHaveBeenCalled();
      expect(confirmMock).not.toHaveBeenCalled();
      expect(runBootstrapMock).not.toHaveBeenCalled();
    });

    it('does NOT prompt when no deps are missing', async () => {
      seedSingleFileManifest();
      findMissingDepsMock.mockResolvedValue([]);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(findMissingDepsMock).toHaveBeenCalledTimes(1);
      expect(confirmMock).not.toHaveBeenCalled();
      expect(runBootstrapMock).not.toHaveBeenCalled();
    });

    it('installDeps=true runs bootstrap without prompting', async () => {
      seedSingleFileManifest();
      findMissingDepsMock.mockResolvedValue([
        { id: 'neovim', description: 'editor' },
        { id: 'yazi', description: 'fm' },
      ]);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({
        all: true,
        noHooks: true,
        noSecrets: true,
        installDeps: true,
      });

      expect(confirmMock).not.toHaveBeenCalled();
      expect(runBootstrapMock).toHaveBeenCalledWith({
        tools: 'neovim,yazi',
        yes: true,
      });
    });

    it('installDeps=false logs advisory and does NOT run bootstrap', async () => {
      seedSingleFileManifest();
      findMissingDepsMock.mockResolvedValue([{ id: 'neovim', description: 'editor' }]);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({
        all: true,
        noHooks: true,
        noSecrets: true,
        installDeps: false,
      });

      expect(confirmMock).not.toHaveBeenCalled();
      expect(runBootstrapMock).not.toHaveBeenCalled();
      expect(promptsLogInfoMock).toHaveBeenCalledWith(
        expect.stringContaining('tuck bootstrap --tools neovim')
      );
    });

    it('undefined installDeps + TTY prompts y/n, Yes runs bootstrap', async () => {
      seedSingleFileManifest();
      findMissingDepsMock.mockResolvedValue([{ id: 'neovim', description: 'editor' }]);
      confirmMock.mockResolvedValue(true);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(runBootstrapMock).toHaveBeenCalledWith({ tools: 'neovim', yes: true });
    });

    it('undefined installDeps + TTY + No skips with advisory', async () => {
      seedSingleFileManifest();
      findMissingDepsMock.mockResolvedValue([{ id: 'neovim', description: 'editor' }]);
      confirmMock.mockResolvedValue(false);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(runBootstrapMock).not.toHaveBeenCalled();
      expect(promptsLogInfoMock).toHaveBeenCalledWith(
        expect.stringContaining('tuck bootstrap --tools neovim')
      );
    });

    it('undefined installDeps + non-TTY falls back to advisory (no auto-install)', async () => {
      isInteractiveMock.mockReturnValue(false);
      seedSingleFileManifest();
      findMissingDepsMock.mockResolvedValue([{ id: 'neovim', description: 'editor' }]);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(confirmMock).not.toHaveBeenCalled();
      expect(runBootstrapMock).not.toHaveBeenCalled();
      expect(promptsLogInfoMock).toHaveBeenCalledWith(
        expect.stringContaining('tuck bootstrap --tools neovim')
      );
    });

    it('does not run findMissingDeps when zero files were restored', async () => {
      getAllTrackedFilesMock.mockResolvedValue({}); // empty manifest
      findMissingDepsMock.mockResolvedValue([]);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(findMissingDepsMock).not.toHaveBeenCalled();
    });
  });

  describe('group-assignment prompt (TASK-047)', () => {
    const seedMultiGroupManifest = () => {
      getAllTrackedFilesMock.mockResolvedValue({
        zshrc: {
          source: '~/.zshrc',
          destination: 'files/shell/zshrc',
          category: 'shell',
        },
      });
      getAllGroupsMock.mockResolvedValue(['kali', 'kubuntu']);
      loadConfigMock.mockResolvedValue({
        files: { strategy: 'copy', backupOnRestore: true },
        defaultGroups: [],
      });
    };

    it('passes required: true so clack blocks empty submissions', async () => {
      seedMultiGroupManifest();
      multiselectMock.mockResolvedValueOnce(['kubuntu']);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(multiselectMock).toHaveBeenCalledTimes(1);
      const [, , config] = multiselectMock.mock.calls[0];
      expect(config.required).toBe(true);
    });

    it('persists a single-group selection via saveLocalConfig', async () => {
      seedMultiGroupManifest();
      multiselectMock.mockResolvedValueOnce(['kubuntu']);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(saveLocalConfigMock).toHaveBeenCalledWith({ defaultGroups: ['kubuntu'] });
    });

    it('persists a multi-group selection via saveLocalConfig', async () => {
      seedMultiGroupManifest();
      multiselectMock.mockResolvedValueOnce(['kali', 'kubuntu']);

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({ all: true, noHooks: true, noSecrets: true });

      expect(saveLocalConfigMock).toHaveBeenCalledWith({ defaultGroups: ['kali', 'kubuntu'] });
    });
  });

  // ========== TASK-RB-UNIFY-IMPL `tuck restore --bootstrap -g <group>` ==========

  describe('--bootstrap (restore+bootstrap unified flow)', () => {
    const seedRestoredFile = () => {
      getAllTrackedFilesMock.mockResolvedValue({
        zshrc: {
          source: '~/.zshrc',
          destination: 'files/shell/zshrc',
          category: 'shell',
          groups: ['kubuntu', 'kali', 'common'],
        },
      });
    };

    it('runs runBootstrap with { bundle } for a group whose name matches a bundle', async () => {
      seedRestoredFile();
      loadBootstrapConfigMock.mockResolvedValueOnce({
        tool: [],
        bundles: { kubuntu: ['fzf'] },
        registry: { disabled: [] },
        restore: { ignoreUncovered: [] },
      });

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({
        all: true,
        noHooks: true,
        noSecrets: true,
        bootstrap: true,
        group: ['kubuntu'],
      });

      expect(runBootstrapMock).toHaveBeenCalledWith({ bundle: 'kubuntu', yes: undefined });
    });

    it('forwards options.yes to runBootstrap (non-interactive fresh-host)', async () => {
      seedRestoredFile();
      loadBootstrapConfigMock.mockResolvedValueOnce({
        tool: [],
        bundles: { kubuntu: ['fzf'] },
        registry: { disabled: [] },
        restore: { ignoreUncovered: [] },
      });

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({
        all: true,
        noHooks: true,
        noSecrets: true,
        bootstrap: true,
        yes: true,
        group: ['kubuntu'],
      });

      expect(runBootstrapMock).toHaveBeenCalledWith({ bundle: 'kubuntu', yes: true });
    });

    it('soft-skips a group without a matching bundle (no runBootstrap call)', async () => {
      seedRestoredFile();
      loadBootstrapConfigMock.mockResolvedValueOnce({
        tool: [],
        bundles: {},
        registry: { disabled: [] },
        restore: { ignoreUncovered: [] },
      });

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({
        all: true,
        noHooks: true,
        noSecrets: true,
        bootstrap: true,
        group: ['common'],
      });

      expect(runBootstrapMock).not.toHaveBeenCalled();
    });

    it('multi-group partial match: runs bootstrap only for groups with matching bundles', async () => {
      seedRestoredFile();
      loadBootstrapConfigMock.mockResolvedValueOnce({
        tool: [],
        bundles: { kubuntu: ['fzf'] },
        registry: { disabled: [] },
        restore: { ignoreUncovered: [] },
      });

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({
        all: true,
        noHooks: true,
        noSecrets: true,
        bootstrap: true,
        group: ['kubuntu', 'common'],
      });

      expect(runBootstrapMock).toHaveBeenCalledTimes(1);
      expect(runBootstrapMock).toHaveBeenCalledWith({ bundle: 'kubuntu', yes: undefined });
    });

    it('multi-group full match: runs runBootstrap sequentially for each bundle', async () => {
      seedRestoredFile();
      loadBootstrapConfigMock.mockResolvedValueOnce({
        tool: [],
        bundles: { kubuntu: ['fzf'], kali: ['ripgrep'] },
        registry: { disabled: [] },
        restore: { ignoreUncovered: [] },
      });

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({
        all: true,
        noHooks: true,
        noSecrets: true,
        bootstrap: true,
        group: ['kubuntu', 'kali'],
      });

      expect(runBootstrapMock).toHaveBeenCalledTimes(2);
      expect(runBootstrapMock).toHaveBeenNthCalledWith(1, { bundle: 'kubuntu', yes: undefined });
      expect(runBootstrapMock).toHaveBeenNthCalledWith(2, { bundle: 'kali', yes: undefined });
    });

    it('falls back to defaultGroups when no -g is passed', async () => {
      seedRestoredFile();
      loadConfigMock.mockResolvedValue({
        files: { strategy: 'copy', backupOnRestore: true },
        defaultGroups: ['kubuntu'],
      });
      loadBootstrapConfigMock.mockResolvedValueOnce({
        tool: [],
        bundles: { kubuntu: ['fzf'] },
        registry: { disabled: [] },
        restore: { ignoreUncovered: [] },
      });

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({
        all: true,
        noHooks: true,
        noSecrets: true,
        bootstrap: true,
      });

      expect(runBootstrapMock).toHaveBeenCalledWith({ bundle: 'kubuntu', yes: undefined });
    });

    it('does NOT run bootstrap on --dry-run', async () => {
      seedRestoredFile();
      loadBootstrapConfigMock.mockResolvedValueOnce({
        tool: [],
        bundles: { kubuntu: ['fzf'] },
        registry: { disabled: [] },
        restore: { ignoreUncovered: [] },
      });

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({
        all: true,
        noHooks: true,
        noSecrets: true,
        bootstrap: true,
        dryRun: true,
        group: ['kubuntu'],
      });

      expect(runBootstrapMock).not.toHaveBeenCalled();
    });

    it('is a silent no-op when --bootstrap is not set (backward compat)', async () => {
      seedRestoredFile();

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({
        all: true,
        noHooks: true,
        noSecrets: true,
        group: ['kubuntu'],
      });

      expect(runBootstrapMock).not.toHaveBeenCalled();
      expect(loadBootstrapConfigMock).not.toHaveBeenCalled();
    });

    it('-y end-to-end fires zero confirms and forwards yes:true to runBootstrap', async () => {
      // Q2 decision audit: non-interactive fresh-host (`tuck restore --bootstrap
      // -g kubuntu -y`) must surface zero prompts. This covers the bundle-call
      // seam — TASK-048's missing-deps tail has its own coverage above for
      // `installDeps: true` → no confirm; `yes: true` here is the bootstrap-side
      // forward. Combined, `-y --install-deps` paper over every prompt on the
      // path.
      seedRestoredFile();
      loadBootstrapConfigMock.mockResolvedValueOnce({
        tool: [],
        bundles: { kubuntu: ['fzf'] },
        registry: { disabled: [] },
        restore: { ignoreUncovered: [] },
      });

      const { runRestore } = await import('../../src/commands/restore.js');
      await runRestore({
        all: true,
        noHooks: true,
        noSecrets: true,
        bootstrap: true,
        yes: true,
        installDeps: true,
        group: ['kubuntu'],
      });

      expect(confirmMock).not.toHaveBeenCalled();
      expect(runBootstrapMock).toHaveBeenCalledWith({ bundle: 'kubuntu', yes: true });
    });
  });
});
