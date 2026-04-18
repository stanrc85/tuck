import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadManifestMock = vi.fn();
const getAllTrackedFilesMock = vi.fn();
const removeFileFromManifestMock = vi.fn();
const getTrackedFileBySourceMock = vi.fn();
const pathExistsMock = vi.fn();
const deleteFileOrDirMock = vi.fn();
const stageAllMock = vi.fn();
const commitMock = vi.fn();
const pushMock = vi.fn();
const hasRemoteMock = vi.fn();
const loggerSuccessMock = vi.fn();
const loggerErrorMock = vi.fn();
const loggerWarningMock = vi.fn();
const loggerInfoMock = vi.fn();
const promptConfirmMock = vi.fn();

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
    warning: loggerWarningMock,
    warn: loggerWarningMock,
    success: loggerSuccessMock,
    error: loggerErrorMock,
    blank: vi.fn(),
    dim: vi.fn(),
    file: vi.fn(),
    heading: vi.fn(),
  },
  withSpinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../src/lib/paths.js', () => ({
  getTuckDir: vi.fn(() => '/test-home/.tuck'),
  expandPath: vi.fn((p: string) => p.replace(/^~\//, '/test-home/')),
  collapsePath: vi.fn((p: string) => p.replace(/^\/test-home\//, '~/')),
  pathExists: pathExistsMock,
  validateSafeSourcePath: vi.fn(),
  getSafeRepoPathFromDestination: vi.fn(
    (tuckDir: string, dest: string) => `${tuckDir}/${dest}`
  ),
}));

vi.mock('../../src/lib/manifest.js', () => ({
  loadManifest: loadManifestMock,
  getAllTrackedFiles: getAllTrackedFilesMock,
  removeFileFromManifest: removeFileFromManifestMock,
  getTrackedFileBySource: getTrackedFileBySourceMock,
  assertMigrated: vi.fn(),
}));

vi.mock('../../src/lib/files.js', () => ({
  deleteFileOrDir: deleteFileOrDirMock,
}));

vi.mock('../../src/lib/git.js', () => ({
  stageAll: stageAllMock,
  commit: commitMock,
  push: pushMock,
  hasRemote: hasRemoteMock,
}));

describe('remove --push', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadManifestMock.mockResolvedValue({
      version: '2.0.0',
      files: {
        zshrc: {
          source: '~/.zshrc',
          destination: 'files/shell/zshrc',
          category: 'shell',
          groups: ['home'],
        },
      },
    });
    getTrackedFileBySourceMock.mockResolvedValue({
      id: 'zshrc',
      file: {
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        category: 'shell',
        groups: ['home'],
      },
    });
    pathExistsMock.mockResolvedValue(true);
    hasRemoteMock.mockResolvedValue(true);
  });

  it('untracks, deletes, commits, and pushes when --push is set', async () => {
    const { runRemove } = await import('../../src/commands/remove.js');

    await runRemove(['~/.zshrc'], { push: true });

    expect(removeFileFromManifestMock).toHaveBeenCalledWith('/test-home/.tuck', 'zshrc');
    expect(deleteFileOrDirMock).toHaveBeenCalledWith('/test-home/.tuck/files/shell/zshrc');
    expect(stageAllMock).toHaveBeenCalledWith('/test-home/.tuck');
    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(commitMock.mock.calls[0][1]).toMatch(/^chore\(untrack\):/);
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('--push implies --delete (source in repo is deleted)', async () => {
    const { runRemove } = await import('../../src/commands/remove.js');

    await runRemove(['~/.zshrc'], { push: true, delete: false });

    expect(deleteFileOrDirMock).toHaveBeenCalledTimes(1);
  });

  it('honors custom commit message via -m', async () => {
    const { runRemove } = await import('../../src/commands/remove.js');

    await runRemove(['~/.zshrc'], { push: true, message: 'chore: drop legacy zshrc' });

    expect(commitMock).toHaveBeenCalledWith(
      '/test-home/.tuck',
      'chore: drop legacy zshrc'
    );
  });

  it('refuses to push when no remote is configured', async () => {
    hasRemoteMock.mockResolvedValueOnce(false);
    const { runRemove } = await import('../../src/commands/remove.js');

    await expect(runRemove(['~/.zshrc'], { push: true })).rejects.toThrow(/no remote/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('retries up to 3 times on push failure when user confirms', async () => {
    pushMock
      .mockRejectedValueOnce(new Error('net glitch 1'))
      .mockRejectedValueOnce(new Error('net glitch 2'))
      .mockResolvedValueOnce(undefined);
    promptConfirmMock.mockResolvedValue(true);

    const { runRemove } = await import('../../src/commands/remove.js');
    await runRemove(['~/.zshrc'], { push: true });

    expect(pushMock).toHaveBeenCalledTimes(3);
    expect(commitMock).toHaveBeenCalledTimes(1); // commit preserved, not repeated
  });

  it('stops retrying when user declines and preserves the commit', async () => {
    pushMock.mockRejectedValue(new Error('boom'));
    promptConfirmMock.mockResolvedValueOnce(false);

    const { runRemove } = await import('../../src/commands/remove.js');
    await runRemove(['~/.zshrc'], { push: true });

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(commitMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after 3 failed attempts and leaves the commit local', async () => {
    pushMock.mockRejectedValue(new Error('still failing'));
    promptConfirmMock.mockResolvedValue(true);

    const { runRemove } = await import('../../src/commands/remove.js');
    await runRemove(['~/.zshrc'], { push: true });

    expect(pushMock).toHaveBeenCalledTimes(3);
    expect(commitMock).toHaveBeenCalledTimes(1);
  });
});
