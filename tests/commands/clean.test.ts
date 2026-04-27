import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadManifestMock = vi.fn();
const assertMigratedMock = vi.fn();
const scanOrphansMock = vi.fn();
const deleteOrphansMock = vi.fn();
const createSnapshotMock = vi.fn();
const stageAllMock = vi.fn();
const commitMock = vi.fn();
const pushMock = vi.fn();
const hasRemoteMock = vi.fn();
const promptConfirmMock = vi.fn();
const isInteractiveMock = vi.fn();
const loggerInfoMock = vi.fn();

vi.mock('../../src/ui/index.js', () => ({
  prompts: {
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    confirm: promptConfirmMock,
    multiselect: vi.fn(),
    note: vi.fn(),
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
    success: vi.fn(),
    error: vi.fn(),
    blank: vi.fn(),
    dim: vi.fn(),
    file: vi.fn(),
    heading: vi.fn(),
  },
  withSpinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  isInteractive: isInteractiveMock,
  formatCount: (n: number, singular: string, plural?: string) =>
    `${n} ${n === 1 ? singular : plural || singular + 's'}`,
  colors: {
    muted: (s: string) => s,
    success: (s: string) => s,
    brand: (s: string) => s,
    brandBold: (s: string) => s,
    bold: (s: string) => s,
    dim: (s: string) => s,
  },
}));

vi.mock('../../src/lib/paths.js', () => ({
  getTuckDir: vi.fn(() => '/test-home/.tuck'),
  collapsePath: vi.fn((p: string) => p.replace(/^\/test-home\//, '~/')),
}));

vi.mock('../../src/lib/manifest.js', () => ({
  loadManifest: loadManifestMock,
  assertMigrated: assertMigratedMock,
}));

vi.mock('../../src/lib/clean.js', () => ({
  scanOrphans: scanOrphansMock,
  deleteOrphans: deleteOrphansMock,
}));

vi.mock('../../src/lib/files.js', () => ({
  formatFileSize: (n: number) => `${n} B`,
}));

vi.mock('../../src/lib/timemachine.js', () => ({
  createSnapshot: createSnapshotMock,
  pruneSnapshotsFromConfig: vi.fn(),
}));

vi.mock('../../src/lib/git.js', () => ({
  stageAll: stageAllMock,
  commit: commitMock,
  push: pushMock,
  hasRemote: hasRemoteMock,
}));

const sampleResult = () => ({
  orphanFiles: [
    {
      absolutePath: '/test-home/.tuck/files/shell/old-bashrc',
      relativePath: 'files/shell/old-bashrc',
      size: 42,
    },
  ],
  orphanDirs: [],
  missingFromDisk: [],
  totalSize: 42,
});

const emptyResult = () => ({
  orphanFiles: [],
  orphanDirs: [],
  missingFromDisk: [],
  totalSize: 0,
});

describe('tuck clean', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadManifestMock.mockResolvedValue({ version: '2.0.0', files: {} });
    isInteractiveMock.mockReturnValue(true);
    hasRemoteMock.mockResolvedValue(true);
  });

  it('is a no-op when there are no orphans and no missing entries', async () => {
    scanOrphansMock.mockResolvedValue(emptyResult());
    const { runClean } = await import('../../src/commands/clean.js');

    await runClean({});

    expect(deleteOrphansMock).not.toHaveBeenCalled();
    expect(createSnapshotMock).not.toHaveBeenCalled();
    expect(promptConfirmMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it('--dry-run prints but never deletes, snapshots, or prompts', async () => {
    scanOrphansMock.mockResolvedValue(sampleResult());
    const { runClean } = await import('../../src/commands/clean.js');

    await runClean({ dryRun: true });

    expect(deleteOrphansMock).not.toHaveBeenCalled();
    expect(createSnapshotMock).not.toHaveBeenCalled();
    expect(promptConfirmMock).not.toHaveBeenCalled();
  });

  it('prompts for confirmation before deleting (interactive)', async () => {
    scanOrphansMock.mockResolvedValue(sampleResult());
    promptConfirmMock.mockResolvedValueOnce(true);
    const { runClean } = await import('../../src/commands/clean.js');

    await runClean({});

    expect(promptConfirmMock).toHaveBeenCalledTimes(1);
    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
    expect(deleteOrphansMock).toHaveBeenCalledTimes(1);
  });

  it('aborts deletion when the user declines the confirmation', async () => {
    scanOrphansMock.mockResolvedValue(sampleResult());
    promptConfirmMock.mockResolvedValueOnce(false);
    const { runClean } = await import('../../src/commands/clean.js');

    await runClean({});

    expect(deleteOrphansMock).not.toHaveBeenCalled();
    expect(createSnapshotMock).not.toHaveBeenCalled();
  });

  it('-y skips the confirmation prompt', async () => {
    scanOrphansMock.mockResolvedValue(sampleResult());
    const { runClean } = await import('../../src/commands/clean.js');

    await runClean({ yes: true });

    expect(promptConfirmMock).not.toHaveBeenCalled();
    expect(createSnapshotMock).toHaveBeenCalledTimes(1);
    expect(deleteOrphansMock).toHaveBeenCalledTimes(1);
  });

  it('creates a snapshot before deleting', async () => {
    scanOrphansMock.mockResolvedValue(sampleResult());
    const order: string[] = [];
    createSnapshotMock.mockImplementation(async () => {
      order.push('snapshot');
    });
    deleteOrphansMock.mockImplementation(async () => {
      order.push('delete');
    });

    const { runClean } = await import('../../src/commands/clean.js');
    await runClean({ yes: true });

    expect(order).toEqual(['snapshot', 'delete']);
    expect(createSnapshotMock).toHaveBeenCalledWith(
      ['/test-home/.tuck/files/shell/old-bashrc'],
      expect.stringContaining('Pre-clean snapshot'),
      { kind: 'clean' }
    );
  });

  it('--commit stages + commits with the default chore(clean) message', async () => {
    scanOrphansMock.mockResolvedValue(sampleResult());
    const { runClean } = await import('../../src/commands/clean.js');

    await runClean({ yes: true, commit: true });

    expect(stageAllMock).toHaveBeenCalledWith('/test-home/.tuck');
    expect(commitMock).toHaveBeenCalledWith(
      '/test-home/.tuck',
      'chore(clean): remove 1 orphaned file'
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('-m overrides the default commit message', async () => {
    scanOrphansMock.mockResolvedValue(sampleResult());
    const { runClean } = await import('../../src/commands/clean.js');

    await runClean({ yes: true, commit: true, message: 'chore: drop cruft' });

    expect(commitMock).toHaveBeenCalledWith('/test-home/.tuck', 'chore: drop cruft');
  });

  it('--push commits + pushes to the remote', async () => {
    scanOrphansMock.mockResolvedValue(sampleResult());
    const { runClean } = await import('../../src/commands/clean.js');

    await runClean({ yes: true, push: true });

    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('--push refuses to push when no remote is configured', async () => {
    hasRemoteMock.mockResolvedValueOnce(false);
    scanOrphansMock.mockResolvedValue(sampleResult());
    const { runClean } = await import('../../src/commands/clean.js');

    await expect(runClean({ yes: true, push: true })).rejects.toThrow(/no remote/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('fails fast with NonInteractivePromptError when no TTY and no -y / --dry-run', async () => {
    scanOrphansMock.mockResolvedValue(sampleResult());
    isInteractiveMock.mockReturnValue(false);
    const { runClean } = await import('../../src/commands/clean.js');

    await expect(runClean({})).rejects.toMatchObject({
      code: 'NON_INTERACTIVE_PROMPT',
    });
    expect(deleteOrphansMock).not.toHaveBeenCalled();
  });

  it('--dry-run still works in non-interactive mode', async () => {
    scanOrphansMock.mockResolvedValue(sampleResult());
    isInteractiveMock.mockReturnValue(false);
    const { runClean } = await import('../../src/commands/clean.js');

    await runClean({ dryRun: true });

    expect(deleteOrphansMock).not.toHaveBeenCalled();
  });
});
