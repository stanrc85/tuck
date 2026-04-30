import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockColors, mockFormatCount, mockOutro } from '../utils/uiMocks.js';

const loadManifestMock = vi.fn();
const checkLocalModeMock = vi.fn();
const showLocalModeWarningForPullMock = vi.fn();
const pullMock = vi.fn();
const fetchMock = vi.fn();
const hasRemoteMock = vi.fn();
const getRemoteUrlMock = vi.fn();
const getStatusMock = vi.fn();
const getCurrentBranchMock = vi.fn();
const getAheadBehindMock = vi.fn();
const resetHardMock = vi.fn();
const promptsIntroMock = vi.fn();
const promptsOutroMock = mockOutro();

vi.mock('../../src/ui/index.js', () => ({
  prompts: {
    intro: promptsIntroMock,
    outro: promptsOutroMock,
    confirm: vi.fn().mockResolvedValue(true),
    note: vi.fn(),
    cancel: vi.fn(),
    log: {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      message: vi.fn(),
    },
  },
  withSpinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  colors: mockColors(),
  formatCount: mockFormatCount,
}));

vi.mock('../../src/lib/paths.js', () => ({
  getTuckDir: vi.fn(() => '/test-home/.tuck'),
}));

vi.mock('../../src/lib/manifest.js', () => ({
  loadManifest: loadManifestMock,
  assertMigrated: vi.fn(),
}));

vi.mock('../../src/lib/remoteChecks.js', () => ({
  checkLocalMode: checkLocalModeMock,
  showLocalModeWarningForPull: showLocalModeWarningForPullMock,
}));

vi.mock('../../src/lib/git.js', () => ({
  pull: pullMock,
  fetch: fetchMock,
  hasRemote: hasRemoteMock,
  getRemoteUrl: getRemoteUrlMock,
  getStatus: getStatusMock,
  getCurrentBranch: getCurrentBranchMock,
  getAheadBehind: getAheadBehindMock,
  resetHard: resetHardMock,
}));

describe('pull command', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    loadManifestMock.mockResolvedValue({ files: {} });
    checkLocalModeMock.mockResolvedValue(false);
    showLocalModeWarningForPullMock.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(undefined);
    pullMock.mockResolvedValue(undefined);
    hasRemoteMock.mockResolvedValue(true);
    getRemoteUrlMock.mockResolvedValue('https://github.com/example/dotfiles.git');
    getCurrentBranchMock.mockResolvedValue('main');
    getStatusMock.mockResolvedValue({
      behind: 0,
      ahead: 0,
      modified: [],
      staged: [],
    });
    getAheadBehindMock.mockResolvedValue({ ahead: 0, behind: 0 });
    resetHardMock.mockResolvedValue(undefined);
  });

  it('throws NOT_INITIALIZED when manifest is missing', async () => {
    loadManifestMock.mockRejectedValueOnce(new Error('missing manifest'));
    const { pullCommand } = await import('../../src/commands/pull.js');

    await expect(pullCommand.parseAsync(['node', 'pull', '--rebase'], { from: 'user' })).rejects.toMatchObject({
      code: 'NOT_INITIALIZED',
    });
  });

  it('pulls with rebase in non-interactive mode', async () => {
    getAheadBehindMock.mockResolvedValueOnce({ ahead: 0, behind: 2 });
    const { pullCommand } = await import('../../src/commands/pull.js');

    await pullCommand.parseAsync(['node', 'pull', '--rebase'], { from: 'user' });

    expect(fetchMock).toHaveBeenCalledWith('/test-home/.tuck');
    expect(pullMock).toHaveBeenCalledWith('/test-home/.tuck', { rebase: true });
    expect(promptsOutroMock).toHaveBeenCalledWith('Pulled 2 commits');
  });

  it('runs interactive flow when no flags are provided', async () => {
    const { pullCommand } = await import('../../src/commands/pull.js');

    await pullCommand.parseAsync(['node', 'pull'], { from: 'user' });

    expect(promptsIntroMock).toHaveBeenCalledWith('tuck pull');
    expect(fetchMock).toHaveBeenCalledWith('/test-home/.tuck');
  });

  it('throws when in local-only mode', async () => {
    checkLocalModeMock.mockResolvedValueOnce(true);
    const { pullCommand } = await import('../../src/commands/pull.js');

    await expect(pullCommand.parseAsync(['node', 'pull', '--rebase'], { from: 'user' })).rejects.toMatchObject({
      code: 'GIT_ERROR',
    });
  });

  describe('--mirror mode (TASK-044)', () => {
    it('calls resetHard instead of pull when --mirror is set', async () => {
      const { pullCommand } = await import('../../src/commands/pull.js');
      await pullCommand.parseAsync(['node', 'pull', '--mirror'], { from: 'user' });
      expect(resetHardMock).toHaveBeenCalledWith('/test-home/.tuck', '@{u}');
      expect(pullMock).not.toHaveBeenCalled();
    });

    it('refuses --mirror when ahead>0 without --allow-divergent', async () => {
      getAheadBehindMock.mockResolvedValueOnce({ ahead: 2, behind: 0 });
      const { pullCommand } = await import('../../src/commands/pull.js');
      await expect(
        pullCommand.parseAsync(['node', 'pull', '--mirror'], { from: 'user' })
      ).rejects.toMatchObject({ code: 'DIVERGENCE_DETECTED' });
      expect(resetHardMock).not.toHaveBeenCalled();
    });

    it('allows --mirror with --allow-divergent', async () => {
      getAheadBehindMock.mockResolvedValueOnce({ ahead: 2, behind: 0 });
      const { pullCommand } = await import('../../src/commands/pull.js');
      await pullCommand.parseAsync(['node', 'pull', '--mirror', '--allow-divergent'], {
        from: 'user',
      });
      expect(resetHardMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('divergence gate (TASK-043)', () => {
    it('throws DivergenceError on rebase pull when ahead>0 and behind>0', async () => {
      getAheadBehindMock.mockResolvedValueOnce({ ahead: 1, behind: 2 });
      const { pullCommand } = await import('../../src/commands/pull.js');
      await expect(
        pullCommand.parseAsync(['node', 'pull', '--rebase'], { from: 'user' })
      ).rejects.toMatchObject({ code: 'DIVERGENCE_DETECTED' });
    });

    it('pulls normally with --allow-divergent even when diverged', async () => {
      getAheadBehindMock.mockResolvedValueOnce({ ahead: 1, behind: 2 });
      const { pullCommand } = await import('../../src/commands/pull.js');
      await pullCommand.parseAsync(['node', 'pull', '--rebase', '--allow-divergent'], {
        from: 'user',
      });
      expect(pullMock).toHaveBeenCalled();
    });
  });
});
