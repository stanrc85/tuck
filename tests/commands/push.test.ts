import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadManifestMock = vi.fn();
const getAllGroupsMock = vi.fn();
const loadConfigMock = vi.fn();
const checkLocalModeMock = vi.fn();
const pushMock = vi.fn();
const hasRemoteMock = vi.fn();
const getRemoteUrlMock = vi.fn();
const getStatusMock = vi.fn();
const getCurrentBranchMock = vi.fn();
const addRemoteMock = vi.fn();
const logForcePushMock = vi.fn();
const confirmDangerousMock = vi.fn();

vi.mock('../../src/ui/index.js', () => ({
  prompts: {
    intro: vi.fn(),
    outro: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true),
    confirmDangerous: confirmDangerousMock,
    text: vi.fn(),
    note: vi.fn(),
    cancel: vi.fn(),
    log: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
  },
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
  },
  withSpinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  colors: { dim: (x: string) => x, green: (x: string) => x, yellow: (x: string) => x, cyan: (x: string) => x },
}));

vi.mock('../../src/lib/paths.js', () => ({
  getTuckDir: vi.fn(() => '/test-home/.tuck'),
}));

vi.mock('../../src/lib/manifest.js', () => ({
  loadManifest: loadManifestMock,
  assertMigrated: vi.fn(),
  getAllGroups: getAllGroupsMock,
}));

vi.mock('../../src/lib/config.js', () => ({
  loadConfig: loadConfigMock,
}));

vi.mock('../../src/lib/remoteChecks.js', () => ({
  checkLocalMode: checkLocalModeMock,
  showLocalModeWarningForPush: vi.fn(),
}));

vi.mock('../../src/lib/git.js', () => ({
  push: pushMock,
  hasRemote: hasRemoteMock,
  getRemoteUrl: getRemoteUrlMock,
  getStatus: getStatusMock,
  getCurrentBranch: getCurrentBranchMock,
  addRemote: addRemoteMock,
}));

vi.mock('../../src/lib/audit.js', () => ({
  logForcePush: logForcePushMock,
}));

describe('push command — host-group assignment gate (TASK-046)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    loadManifestMock.mockResolvedValue({ files: {} });
    checkLocalModeMock.mockResolvedValue(false);
    hasRemoteMock.mockResolvedValue(true);
    getCurrentBranchMock.mockResolvedValue('main');
    getRemoteUrlMock.mockResolvedValue('git@github.com:example/dotfiles.git');
    getStatusMock.mockResolvedValue({ ahead: 1, behind: 0, tracking: true, modified: [], staged: [] });
    loadConfigMock.mockResolvedValue({ defaultGroups: [] });
    getAllGroupsMock.mockResolvedValue(['default']);
    confirmDangerousMock.mockResolvedValue(true);
  });

  it('refuses push when manifest has >1 groups + empty defaultGroups', async () => {
    getAllGroupsMock.mockResolvedValue(['kali', 'kubuntu']);
    const { pushCommand } = await import('../../src/commands/push.js');

    // Module-reset between tests means direct `instanceof` would compare against
    // a stale class ref — match on the TuckError `code` field instead.
    await expect(
      pushCommand.parseAsync(['node', 'push', '--force'], { from: 'user' })
    ).rejects.toMatchObject({ code: 'GROUP_REQUIRED' });

    // Gate fires before push or force-confirmation prompt
    expect(pushMock).not.toHaveBeenCalled();
    expect(confirmDangerousMock).not.toHaveBeenCalled();
  });

  it('allows push when host has defaultGroups set', async () => {
    getAllGroupsMock.mockResolvedValue(['kali', 'kubuntu']);
    loadConfigMock.mockResolvedValue({ defaultGroups: ['kali'] });
    const { pushCommand } = await import('../../src/commands/push.js');

    await pushCommand.parseAsync(['node', 'push', '--force'], { from: 'user' });

    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('no-ops on single-group repos regardless of defaultGroups', async () => {
    getAllGroupsMock.mockResolvedValue(['default']);
    loadConfigMock.mockResolvedValue({ defaultGroups: [] });
    const { pushCommand } = await import('../../src/commands/push.js');

    await pushCommand.parseAsync(['node', 'push', '--force'], { from: 'user' });

    expect(pushMock).toHaveBeenCalledTimes(1);
  });
});
