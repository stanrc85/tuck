import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join, sep } from 'path';
import { NotInitializedError } from '../../src/errors.js';

const loadManifestMock = vi.fn();
const getAllTrackedFilesMock = vi.fn();
const updateFileInManifestMock = vi.fn();
const removeFileFromManifestMock = vi.fn();
const getTrackedFileBySourceMock = vi.fn();
const getAllGroupsMock = vi.fn();
const pathExistsMock = vi.fn();
const copyFileOrDirMock = vi.fn();
const getFileChecksumMock = vi.fn();
const deleteFileOrDirMock = vi.fn();
const loadTuckignoreMock = vi.fn();
const isIgnoredMock = vi.fn();
const validateSafeSourcePathMock = vi.fn();
const validateSafeManifestDestinationMock = vi.fn();
const validatePathWithinRootMock = vi.fn();
const runPreSyncHookMock = vi.fn();
const runPostSyncHookMock = vi.fn();
const stageAllMock = vi.fn();
const commitMock = vi.fn();
const hasRemoteMock = vi.fn();
const pushMock = vi.fn();
const loggerInfoMock = vi.fn();
const getStatusMock = vi.fn();

vi.mock('../../src/ui/index.js', () => ({
  prompts: {
    intro: vi.fn(),
    outro: vi.fn(),
    confirm: vi.fn().mockResolvedValue(false),
    confirmDangerous: vi.fn().mockResolvedValue(true),
    select: vi.fn().mockResolvedValue('abort'),
    multiselect: vi.fn(),
    note: vi.fn(),
    cancel: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: '' })),
    log: {
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
      message: vi.fn(),
    },
  },
  logger: {
    info: loggerInfoMock,
    warning: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    file: vi.fn(),
    heading: vi.fn(),
    blank: vi.fn(),
    dim: vi.fn(),
  },
  withSpinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  colors: {
    dim: (x: string) => x,
  },
}));

vi.mock('../../src/lib/paths.js', () => ({
  getTuckDir: vi.fn(() => '/test-home/.tuck'),
  expandPath: vi.fn((p: string) => p.replace(/^~\//, '/test-home/')),
  pathExists: pathExistsMock,
  collapsePath: vi.fn((p: string) => p),
  getDestinationPathFromSource: vi.fn(
    (tuckDir: string, category: string, sourcePath: string) =>
      `${tuckDir}/files/${category}/${String(sourcePath).replace(/^~\//, '')}`
  ),
  detectCategory: vi.fn(() => 'misc'),
  sanitizeFilename: vi.fn((path: string) => path.split('/').pop() || 'file'),
  isDirectory: vi.fn().mockResolvedValue(false),
  validateSafeSourcePath: validateSafeSourcePathMock,
  validateSafeManifestDestination: validateSafeManifestDestinationMock,
  validatePathWithinRoot: validatePathWithinRootMock,
}));

vi.mock('../../src/lib/manifest.js', () => ({
  loadManifest: loadManifestMock,
  getAllTrackedFiles: getAllTrackedFilesMock,
  updateFileInManifest: updateFileInManifestMock,
  removeFileFromManifest: removeFileFromManifestMock,
  getTrackedFileBySource: getTrackedFileBySourceMock,
  assertMigrated: vi.fn(),
  getAllGroups: getAllGroupsMock,
  // Real semantics inlined so group-filter tests exercise the actual behavior
  // instead of a blanket-true stub.
  fileMatchesGroups: (
    file: { groups?: string[] },
    groups: string[] | undefined
  ): boolean => {
    if (!groups || groups.length === 0) return true;
    if (!file.groups || file.groups.length === 0) return false;
    const wanted = new Set(groups);
    return file.groups.some((g) => wanted.has(g));
  },
}));

const loadConfigMock = vi.fn();
vi.mock('../../src/lib/config.js', () => ({
  loadConfig: loadConfigMock,
}));

vi.mock('../../src/lib/git.js', () => ({
  stageAll: stageAllMock,
  commit: commitMock,
  getStatus: getStatusMock,
  push: pushMock,
  hasRemote: hasRemoteMock,
  fetch: vi.fn(),
  pull: vi.fn(),
}));

vi.mock('../../src/lib/files.js', () => ({
  copyFileOrDir: copyFileOrDirMock,
  getFileChecksum: getFileChecksumMock,
  deleteFileOrDir: deleteFileOrDirMock,
  checkFileSizeThreshold: vi.fn().mockResolvedValue({ warn: false, block: false, size: 10 }),
  formatFileSize: vi.fn((n: number) => `${n} B`),
  SIZE_BLOCK_THRESHOLD: 100 * 1024 * 1024,
}));

vi.mock('../../src/lib/tuckignore.js', () => ({
  addToTuckignore: vi.fn(),
  loadTuckignore: loadTuckignoreMock,
  isIgnored: isIgnoredMock,
}));

vi.mock('../../src/lib/hooks.js', () => ({
  runPreSyncHook: runPreSyncHookMock,
  runPostSyncHook: runPostSyncHookMock,
}));

const createSnapshotMock = vi.fn();
const pruneSnapshotsMock = vi.fn();
vi.mock('../../src/lib/timemachine.js', () => ({
  createSnapshot: createSnapshotMock,
  pruneSnapshotsFromConfig: pruneSnapshotsMock,
}));

vi.mock('../../src/lib/detect.js', () => ({
  detectDotfiles: vi.fn().mockResolvedValue([]),
  DETECTION_CATEGORIES: {},
}));

vi.mock('../../src/lib/fileTracking.js', () => ({
  trackFilesWithProgress: vi.fn().mockResolvedValue({
    succeeded: 0,
    failed: 0,
    errors: [],
    sensitiveFiles: [],
  }),
}));

vi.mock('../../src/lib/secrets/index.js', () => ({
  scanForSecrets: vi.fn().mockResolvedValue({ totalSecrets: 0, results: [] }),
  isSecretScanningEnabled: vi.fn().mockResolvedValue(false),
  shouldBlockOnSecrets: vi.fn().mockResolvedValue(true),
  processSecretsForRedaction: vi.fn(),
  redactFile: vi.fn(),
}));

vi.mock('../../src/commands/secrets.js', () => ({
  displayScanResults: vi.fn(),
}));

vi.mock('../../src/lib/audit.js', () => ({
  logForceSecretBypass: vi.fn(),
}));

describe('sync command behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    loadManifestMock.mockResolvedValue({ files: {} });
    loadTuckignoreMock.mockResolvedValue(new Set());
    getAllTrackedFilesMock.mockResolvedValue({});
    pathExistsMock.mockResolvedValue(true);
    isIgnoredMock.mockResolvedValue(false);
    getFileChecksumMock.mockResolvedValue('new-checksum');
    hasRemoteMock.mockResolvedValue(false);
    commitMock.mockResolvedValue('abc123def456');
    getStatusMock.mockResolvedValue({ hasChanges: false, behind: 0 });
    loadConfigMock.mockResolvedValue({ defaultGroups: [] });
    // Default: single-group repo so the TASK-046 sync gate is a no-op. Tests
    // that want to exercise the gate override with `getAllGroupsMock.mockResolvedValueOnce([...])`.
    getAllGroupsMock.mockResolvedValue(['default']);
    validateSafeSourcePathMock.mockImplementation(() => {});
    validateSafeManifestDestinationMock.mockImplementation(() => {});
    validatePathWithinRootMock.mockImplementation(() => {});
  });

  it('throws NotInitializedError when manifest is missing', async () => {
    loadManifestMock.mockRejectedValueOnce(new Error('missing manifest'));
    const { runSync } = await import('../../src/commands/sync.js');

    await expect(runSync()).rejects.toBeInstanceOf(NotInitializedError);
  });

  it('logs no changes when tracked files are unchanged', async () => {
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        checksum: 'same',
      },
    });
    getFileChecksumMock.mockResolvedValue('same');
    const { runSyncCommand } = await import('../../src/commands/sync.js');

    await runSyncCommand('sync: noop', { noCommit: true, noHooks: true, scan: false, pull: false });

    expect(loggerInfoMock).toHaveBeenCalledWith('No changes detected');
    expect(copyFileOrDirMock).not.toHaveBeenCalled();
  });

  it('syncs modified files and updates manifest when changes exist', async () => {
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        checksum: 'old',
      },
    });
    getFileChecksumMock.mockResolvedValue('new');
    const { runSyncCommand } = await import('../../src/commands/sync.js');

    await runSyncCommand('sync: update', { noCommit: true, noHooks: true, scan: false, pull: false });

    expect(copyFileOrDirMock).toHaveBeenCalledTimes(1);
    expect(updateFileInManifestMock).toHaveBeenCalledTimes(1);
    expect(validatePathWithinRootMock).toHaveBeenCalledWith(
      join('/test-home/.tuck', 'files', 'shell', 'zshrc'),
      '/test-home/.tuck',
      'sync destination'
    );
    expect(stageAllMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();
  });

  // preSync hook fires BEFORE change detection in both sync paths so that
  // hooks which *produce* tracked files (e.g. regenerating cheatsheet.json
  // on every sync) get their output picked up on the same run. Previously
  // the hook lived inside syncFiles and only ran when changes were already
  // detected — so a "regen on every sync" hook would never fire on the
  // first sync (no changes → early-return → hook never runs → no file
  // produced → still no changes next run).
  it('runs preSync hook even when there are no changes (non-interactive)', async () => {
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        checksum: 'same',
      },
    });
    getFileChecksumMock.mockResolvedValue('same');
    const { runSyncCommand } = await import('../../src/commands/sync.js');

    await runSyncCommand('sync: noop', { noCommit: true, scan: false, pull: false });

    expect(runPreSyncHookMock).toHaveBeenCalledTimes(1);
    expect(loggerInfoMock).toHaveBeenCalledWith('No changes detected');
    expect(copyFileOrDirMock).not.toHaveBeenCalled();
  });

  it('runs preSync hook even when there are no changes (interactive)', async () => {
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        checksum: 'same',
      },
    });
    getFileChecksumMock.mockResolvedValue('same');
    const { runSync } = await import('../../src/commands/sync.js');

    await runSync({ scan: false, pull: false });

    expect(runPreSyncHookMock).toHaveBeenCalledTimes(1);
    expect(copyFileOrDirMock).not.toHaveBeenCalled();
  });

  // Regression guard: now that the hook lives upstream of syncFiles, a
  // sync with detected changes must call it exactly once — not zero
  // (regression on the move) and not twice (regression if a stale call
  // is re-introduced inside syncFiles).
  it('runs preSync hook exactly once when changes exist', async () => {
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        checksum: 'old',
      },
    });
    getFileChecksumMock.mockResolvedValue('new');
    const { runSyncCommand } = await import('../../src/commands/sync.js');

    await runSyncCommand('sync: update', { noCommit: true, scan: false, pull: false });

    expect(runPreSyncHookMock).toHaveBeenCalledTimes(1);
  });

  it('creates a pre-sync snapshot (kind="sync") of repo copies before overwriting', async () => {
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        checksum: 'old',
      },
    });
    getFileChecksumMock.mockResolvedValue('new');
    const { runSyncCommand } = await import('../../src/commands/sync.js');

    await runSyncCommand('sync: update', {
      noCommit: true,
      noHooks: true,
      scan: false,
      pull: false,
    });

    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
    const [paths, reason, opts] = createSnapshotMock.mock.calls[0];
    expect(paths[0]).toContain(join('files', 'shell', 'zshrc'));
    expect(reason).toMatch(/Pre-sync snapshot/);
    expect(opts).toEqual({ kind: 'sync' });
    expect(pruneSnapshotsMock).toHaveBeenCalledTimes(1);
  });

  it('skips snapshot creation when no modified files exist in the repo', async () => {
    // Modified tracked file but repo copy does not yet exist on disk → nothing to snapshot.
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        checksum: 'old',
      },
    });
    getFileChecksumMock.mockResolvedValue('new');
    // pathExists controls both the change-detection path check and the repo-side
    // snapshot check; return false when it's the repo file under /test-home/.tuck.
    // Build the prefix with join+sep so it matches Windows backslash paths in CI.
    const repoFilesPrefix = join('/test-home/.tuck', 'files') + sep;
    pathExistsMock.mockImplementation(async (p: string) => {
      return !String(p).startsWith(repoFilesPrefix);
    });

    const { runSyncCommand } = await import('../../src/commands/sync.js');
    await runSyncCommand('sync: new file', {
      noCommit: true,
      noHooks: true,
      scan: false,
      pull: false,
    });

    expect(createSnapshotMock).not.toHaveBeenCalled();
  });

  it('fails fast when manifest destination is unsafe', async () => {
    getAllTrackedFilesMock.mockResolvedValue({
      zshrc: {
        source: '~/.zshrc',
        destination: '../../outside',
        checksum: 'old',
      },
    });
    validateSafeManifestDestinationMock.mockImplementationOnce(() => {
      throw new Error('Unsafe manifest destination detected');
    });
    const { runSyncCommand } = await import('../../src/commands/sync.js');

    await expect(
      runSyncCommand('sync: unsafe manifest', { noCommit: true, noHooks: true, scan: false, pull: false })
    ).rejects.toThrow('Unsafe manifest destination detected');
    expect(copyFileOrDirMock).not.toHaveBeenCalled();
  });

  // ========== Host-group filtering ==========

  describe('host-group filtering', () => {
    const kaliFile = {
      source: '~/.kali-rc',
      destination: 'files/shell/kali-rc',
      checksum: 'old',
      groups: ['kali'],
    };
    const macFile = {
      source: '~/.mac-rc',
      destination: 'files/shell/mac-rc',
      checksum: 'old',
      groups: ['work-mac'],
    };
    const sharedFile = {
      source: '~/.shared-rc',
      destination: 'files/shell/shared-rc',
      checksum: 'old',
      groups: ['kali', 'work-mac'],
    };

    it('processes every tracked file when no -g flag and no config.defaultGroups (legacy behavior)', async () => {
      getAllTrackedFilesMock.mockResolvedValue({ k: kaliFile, m: macFile });
      getFileChecksumMock.mockResolvedValue('new');
      const { runSyncCommand } = await import('../../src/commands/sync.js');

      await runSyncCommand('sync: all', { noCommit: true, noHooks: true, scan: false, pull: false });

      // Both files flagged modified + copied
      expect(copyFileOrDirMock).toHaveBeenCalledTimes(2);
    });

    it('scopes to config.defaultGroups when -g flag is omitted', async () => {
      getAllTrackedFilesMock.mockResolvedValue({ k: kaliFile, m: macFile, s: sharedFile });
      getFileChecksumMock.mockResolvedValue('new');
      loadConfigMock.mockResolvedValue({ defaultGroups: ['kali'] });
      const { runSyncCommand } = await import('../../src/commands/sync.js');

      await runSyncCommand('sync: kali host', {
        noCommit: true,
        noHooks: true,
        scan: false,
        pull: false,
      });

      // kali + shared match; mac-only does not
      expect(copyFileOrDirMock).toHaveBeenCalledTimes(2);
      const copiedSources = copyFileOrDirMock.mock.calls.map((call) => call[0]);
      expect(copiedSources).toContain('/test-home/.kali-rc');
      expect(copiedSources).toContain('/test-home/.shared-rc');
      expect(copiedSources).not.toContain('/test-home/.mac-rc');
    });

    it('CLI -g flag overrides config.defaultGroups', async () => {
      getAllTrackedFilesMock.mockResolvedValue({ k: kaliFile, m: macFile });
      getFileChecksumMock.mockResolvedValue('new');
      loadConfigMock.mockResolvedValue({ defaultGroups: ['kali'] });
      const { runSyncCommand } = await import('../../src/commands/sync.js');

      await runSyncCommand('sync: mac override', {
        noCommit: true,
        noHooks: true,
        scan: false,
        pull: false,
        group: ['work-mac'],
      });

      // Only mac-tagged file synced; kali file filtered out despite config
      expect(copyFileOrDirMock).toHaveBeenCalledTimes(1);
      expect(copyFileOrDirMock.mock.calls[0][0]).toBe('/test-home/.mac-rc');
    });

    it('does NOT flag out-of-group file as deleted when its source is missing on this host', async () => {
      // Regression guard: before the fix, any tracked file whose source didn't
      // exist on the host was flagged 'deleted' and removed from the manifest.
      // With group filtering active, out-of-group files are skipped entirely.
      getAllTrackedFilesMock.mockResolvedValue({ k: kaliFile, m: macFile });
      loadConfigMock.mockResolvedValue({ defaultGroups: ['kali'] });

      // kali source exists + unchanged; mac source is missing (legitimate — different host)
      pathExistsMock.mockImplementation(async (p: string) => {
        return !String(p).includes('mac-rc');
      });
      getFileChecksumMock.mockResolvedValue(kaliFile.checksum);

      const { runSyncCommand } = await import('../../src/commands/sync.js');
      await runSyncCommand('sync: kali', {
        noCommit: true,
        noHooks: true,
        scan: false,
        pull: false,
      });

      // mac-rc must NOT be removed from manifest — it's simply out of scope
      expect(removeFileFromManifestMock).not.toHaveBeenCalled();
      expect(deleteFileOrDirMock).not.toHaveBeenCalled();
    });

    it('still flags in-group file as deleted when its source is missing (legitimate delete signal)', async () => {
      // Counterpart to the guard above: if an IN-group file is missing, that's
      // a real user intent signal — the file should be untracked.
      getAllTrackedFilesMock.mockResolvedValue({ k: kaliFile });
      loadConfigMock.mockResolvedValue({ defaultGroups: ['kali'] });
      pathExistsMock.mockResolvedValue(false);

      const { runSyncCommand } = await import('../../src/commands/sync.js');
      await runSyncCommand('sync: kali delete', {
        noCommit: true,
        noHooks: true,
        scan: false,
        pull: false,
      });

      expect(removeFileFromManifestMock).toHaveBeenCalledTimes(1);
      expect(deleteFileOrDirMock).toHaveBeenCalledTimes(1);
    });
  });

  // ========== TASK-046 host-group assignment gate ==========

  describe('host-group assignment gate', () => {
    // Protects multi-group repos from hosts that haven't been assigned —
    // otherwise resolveGroupFilter would return undefined and sync would
    // churn every file across every host's tag.
    const kaliFile = {
      source: '~/.kali-rc',
      destination: 'files/shell/kali-rc',
      checksum: 'old',
      groups: ['kali'],
    };
    const kubuntuFile = {
      source: '~/.kubuntu-rc',
      destination: 'files/shell/kubuntu-rc',
      checksum: 'old',
      groups: ['kubuntu'],
    };

    it('refuses sync when manifest has >1 groups + no -g + no defaultGroups', async () => {
      getAllTrackedFilesMock.mockResolvedValue({ k: kaliFile, u: kubuntuFile });
      getAllGroupsMock.mockResolvedValue(['kali', 'kubuntu']);
      loadConfigMock.mockResolvedValue({ defaultGroups: [] });
      const { runSyncCommand } = await import('../../src/commands/sync.js');

      await expect(
        runSyncCommand('sync: unassigned', { noCommit: true, noHooks: true, scan: false, pull: false })
      ).rejects.toThrow(/no default group assigned/);

      // Gate fires before any work
      expect(copyFileOrDirMock).not.toHaveBeenCalled();
      expect(commitMock).not.toHaveBeenCalled();
    });

    it('allows sync when -g is passed as a one-shot override', async () => {
      getAllTrackedFilesMock.mockResolvedValue({ k: kaliFile, u: kubuntuFile });
      getAllGroupsMock.mockResolvedValue(['kali', 'kubuntu']);
      loadConfigMock.mockResolvedValue({ defaultGroups: [] });
      getFileChecksumMock.mockResolvedValue('new');
      const { runSyncCommand } = await import('../../src/commands/sync.js');

      await runSyncCommand('sync: one-shot', {
        noCommit: true,
        noHooks: true,
        scan: false,
        pull: false,
        group: ['kali'],
      });

      // Kali file syncs; no throw
      expect(copyFileOrDirMock).toHaveBeenCalled();
    });

    it('allows sync when defaultGroups is set for the host', async () => {
      getAllTrackedFilesMock.mockResolvedValue({ k: kaliFile, u: kubuntuFile });
      getAllGroupsMock.mockResolvedValue(['kali', 'kubuntu']);
      loadConfigMock.mockResolvedValue({ defaultGroups: ['kali'] });
      getFileChecksumMock.mockResolvedValue('new');
      const { runSyncCommand } = await import('../../src/commands/sync.js');

      await runSyncCommand('sync: assigned', {
        noCommit: true,
        noHooks: true,
        scan: false,
        pull: false,
      });

      expect(copyFileOrDirMock).toHaveBeenCalled();
    });

    it('no-ops on single-group repos (gate is multi-group-only)', async () => {
      // Legacy / single-group repos must keep working even with empty defaults.
      getAllTrackedFilesMock.mockResolvedValue({ k: kaliFile });
      getAllGroupsMock.mockResolvedValue(['default']);
      loadConfigMock.mockResolvedValue({ defaultGroups: [] });
      getFileChecksumMock.mockResolvedValue('new');
      const { runSyncCommand } = await import('../../src/commands/sync.js');

      await expect(
        runSyncCommand('sync: single-group', { noCommit: true, noHooks: true, scan: false, pull: false })
      ).resolves.toBeUndefined();
    });
  });

  // ========== --list preview ==========

  describe('sync --list preview', () => {
    const kaliFile = {
      source: '~/.kali-rc',
      destination: 'files/shell/kali-rc',
      checksum: 'old',
      groups: ['kali'],
    };
    const macFile = {
      source: '~/.mac-rc',
      destination: 'files/shell/mac-rc',
      checksum: 'old',
      groups: ['work-mac'],
    };

    it('executes no writes (no copy, no stage, no commit, no push, no hooks)', async () => {
      getAllTrackedFilesMock.mockResolvedValue({ k: kaliFile });
      getFileChecksumMock.mockResolvedValue('new');
      const { runSync } = await import('../../src/commands/sync.js');

      await runSync({ list: true });

      expect(copyFileOrDirMock).not.toHaveBeenCalled();
      expect(deleteFileOrDirMock).not.toHaveBeenCalled();
      expect(updateFileInManifestMock).not.toHaveBeenCalled();
      expect(removeFileFromManifestMock).not.toHaveBeenCalled();
      expect(stageAllMock).not.toHaveBeenCalled();
      expect(commitMock).not.toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
      expect(runPreSyncHookMock).not.toHaveBeenCalled();
      expect(runPostSyncHookMock).not.toHaveBeenCalled();
      expect(createSnapshotMock).not.toHaveBeenCalled();
    });

    it('honors group-filter precedence just like a real sync (CLI -g overrides defaultGroups)', async () => {
      getAllTrackedFilesMock.mockResolvedValue({ k: kaliFile, m: macFile });
      getFileChecksumMock.mockResolvedValue('new');
      loadConfigMock.mockResolvedValue({ defaultGroups: ['kali'] });
      const { runSync } = await import('../../src/commands/sync.js');

      // Should still perform no writes even though the filter is being applied
      await runSync({ list: true, group: ['work-mac'] });

      expect(copyFileOrDirMock).not.toHaveBeenCalled();
      expect(commitMock).not.toHaveBeenCalled();
    });

    it('exits cleanly on a clean repo (no changes to sync)', async () => {
      getAllTrackedFilesMock.mockResolvedValue({ k: kaliFile });
      // Source matches stored checksum → no changes detected
      getFileChecksumMock.mockResolvedValue(kaliFile.checksum);
      const { runSync } = await import('../../src/commands/sync.js');

      await expect(runSync({ list: true })).resolves.toBeUndefined();
      expect(copyFileOrDirMock).not.toHaveBeenCalled();
    });
  });
});
