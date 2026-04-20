import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join, sep } from 'path';
import { NotInitializedError, NonInteractivePromptError } from '../../src/errors.js';

const isInteractiveMock = vi.fn(() => true);
const multiselectMock = vi.fn();
const loggerWarningMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerSuccessMock = vi.fn();

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
    outro: vi.fn(),
    multiselect: multiselectMock,
    select: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    note: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: '' })),
    log: {
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    },
  },
  logger: {
    warning: loggerWarningMock,
    info: loggerInfoMock,
    success: loggerSuccessMock,
    heading: vi.fn(),
    blank: vi.fn(),
    file: vi.fn(),
  },
  withSpinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  isInteractive: isInteractiveMock,
}));

vi.mock('../../src/ui/theme.js', () => ({
  colors: {
    yellow: (x: string) => x,
    dim: (x: string) => x,
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
      expect(loggerWarningMock).toHaveBeenCalledWith(
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
});
