import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockColors, mockFormatCount, mockOutro } from '../utils/uiMocks.js';

const cloneRepoMock = vi.fn();
const createManifestMock = vi.fn();
const saveConfigMock = vi.fn();
const saveLocalConfigMock = vi.fn();
const loadConfigMock = vi.fn();
const loadLocalConfigMock = vi.fn();
const detectOsGroupMock = vi.fn();
const pathExistsMock = vi.fn();
const promptsLogSuccessMock = vi.fn();
const promptsLogInfoMock = vi.fn();

vi.mock('../../src/ui/index.js', () => ({
  banner: vi.fn(),
  nextSteps: vi.fn(),
  withSpinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  prompts: {
    intro: vi.fn(),
    outro: mockOutro(),
    text: vi.fn(),
    confirm: vi.fn(),
    select: vi.fn(),
    multiselect: vi.fn(),
    note: vi.fn(),
    cancel: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: '' })),
    log: {
      info: promptsLogInfoMock,
      success: promptsLogSuccessMock,
      warning: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
      message: vi.fn(),
    },
  },
  logger: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    dim: vi.fn(),
    blank: vi.fn(),
  },
  colors: mockColors(),
  formatCount: mockFormatCount,
}));

vi.mock('../../src/lib/paths.js', () => ({
  getTuckDir: vi.fn((dir?: string) => (dir === '~/.custom' ? '/test-home/.custom' : '/test-home/.tuck')),
  getManifestPath: vi.fn((tuckDir: string) => `${tuckDir}/.tuckmanifest.json`),
  getConfigPath: vi.fn((tuckDir: string) => `${tuckDir}/.tuckrc.json`),
  getFilesDir: vi.fn((tuckDir: string) => `${tuckDir}/files`),
  getCategoryDir: vi.fn((tuckDir: string, category: string) => `${tuckDir}/files/${category}`),
  getDestinationPathFromSource: vi.fn(
    (tuckDir: string, category: string, sourcePath: string) =>
      `${tuckDir}/files/${category}/${String(sourcePath).replace(/^~\//, '')}`
  ),
  expandPath: vi.fn((p: string) => p.replace(/^~\//, '/test-home/')),
  detectCategory: vi.fn(() => 'misc'),
  sanitizeFilename: vi.fn((path: string) => path.split('/').pop() || 'file'),
  isDirectory: vi.fn().mockResolvedValue(false),
  validateSafeSourcePath: vi.fn(),
  pathExists: pathExistsMock,
  collapsePath: vi.fn((path: string) => path.replace('/test-home', '~')),
}));

vi.mock('../../src/lib/config.js', () => ({
  saveConfig: saveConfigMock,
  saveLocalConfig: saveLocalConfigMock,
  loadConfig: loadConfigMock,
  loadLocalConfig: loadLocalConfigMock,
}));

vi.mock('../../src/lib/osDetect.js', () => ({
  detectOsGroup: detectOsGroupMock,
}));

const getAllGroupsMock = vi.fn();
vi.mock('../../src/lib/manifest.js', () => ({
  createManifest: createManifestMock,
  getAllGroups: getAllGroupsMock,
}));

vi.mock('../../src/lib/git.js', () => ({
  initRepo: vi.fn(),
  addRemote: vi.fn(),
  cloneRepo: cloneRepoMock,
  setDefaultBranch: vi.fn(),
  stageAll: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
}));

vi.mock('../../src/lib/providerSetup.js', () => ({
  setupProvider: vi.fn(),
  detectProviderFromUrl: vi.fn(() => 'local'),
}));

vi.mock('../../src/lib/providers/index.js', () => ({
  getProvider: vi.fn(),
  describeProviderConfig: vi.fn(() => 'local'),
  buildRemoteConfig: vi.fn(() => ({ mode: 'local' })),
}));

vi.mock('../../src/lib/github.js', () => ({
  isGhInstalled: vi.fn(),
  isGhAuthenticated: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  createRepo: vi.fn(),
  getPreferredRepoUrl: vi.fn(),
  getPreferredRemoteProtocol: vi.fn(),
  findDotfilesRepo: vi.fn(),
  ghCloneRepo: vi.fn(),
  checkSSHKeys: vi.fn(),
  testSSHConnection: vi.fn(),
  getSSHKeyInstructions: vi.fn(),
  getFineGrainedTokenInstructions: vi.fn(),
  getClassicTokenInstructions: vi.fn(),
  getGitHubCLIInstallInstructions: vi.fn(),
  storeGitHubCredentials: vi.fn(),
  detectTokenType: vi.fn(),
  configureGitCredentialHelper: vi.fn(),
  configureGitCredentialHelperWithOptions: vi.fn(),
  testStoredCredentials: vi.fn(),
  diagnoseAuthIssue: vi.fn(),
  MIN_GITHUB_TOKEN_LENGTH: 40,
  GITHUB_TOKEN_PREFIXES: ['ghp_'],
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

vi.mock('../../src/lib/validation.js', () => ({
  errorToMessage: vi.fn((error: unknown) => String(error)),
}));

// Mocked so the init-tail prompt (TASK-RB-UNIFY-IMPL) can dynamic-import
// `./restore.js` without actually running a restore.
const runRestoreMock = vi.fn();
vi.mock('../../src/commands/restore.js', () => ({
  runRestore: runRestoreMock,
}));

describe('init command behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloneRepoMock.mockResolvedValue(undefined);
    createManifestMock.mockResolvedValue(undefined);
    saveConfigMock.mockResolvedValue(undefined);
    saveLocalConfigMock.mockResolvedValue(undefined);
    loadConfigMock.mockResolvedValue({ defaultGroups: [] });
    loadLocalConfigMock.mockResolvedValue({});
    detectOsGroupMock.mockResolvedValue(null);
    getAllGroupsMock.mockResolvedValue([]);
    runRestoreMock.mockResolvedValue(undefined);
  });

  it('clones from remote and backfills missing manifest/config', async () => {
    pathExistsMock.mockResolvedValue(false);
    const { runInit } = await import('../../src/commands/init.js');

    await runInit({ from: 'https://github.com/acme/dotfiles.git' });

    expect(cloneRepoMock).toHaveBeenCalledWith(
      'https://github.com/acme/dotfiles.git',
      '/test-home/.tuck'
    );
    expect(createManifestMock).toHaveBeenCalledTimes(1);
    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    expect(promptsLogSuccessMock).toHaveBeenCalled();
    expect(promptsLogInfoMock).toHaveBeenCalledWith('Run `tuck restore --all` to restore dotfiles');
  });

  it('does not recreate manifest/config when cloned repo already contains both', async () => {
    pathExistsMock.mockResolvedValue(true);
    const { runInit } = await import('../../src/commands/init.js');

    await runInit({ from: 'https://github.com/acme/dotfiles.git', dir: '~/.custom' });

    expect(cloneRepoMock).toHaveBeenCalledWith(
      'https://github.com/acme/dotfiles.git',
      '/test-home/.custom'
    );
    expect(createManifestMock).not.toHaveBeenCalled();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  describe('OS detection prompt (TASK-045)', () => {
    it('skips entirely when --no-detect-os is passed', async () => {
      pathExistsMock.mockResolvedValue(false);
      const { runInit } = await import('../../src/commands/init.js');
      await runInit({ from: 'https://github.com/acme/dotfiles.git', detectOs: false });
      expect(detectOsGroupMock).not.toHaveBeenCalled();
      expect(saveLocalConfigMock).not.toHaveBeenCalled();
    });

    it('skips when LOCAL defaultGroups is already populated', async () => {
      pathExistsMock.mockResolvedValue(false);
      loadLocalConfigMock.mockResolvedValueOnce({ defaultGroups: ['ubuntu'] });
      const { runInit } = await import('../../src/commands/init.js');
      await runInit({ from: 'https://github.com/acme/dotfiles.git' });
      expect(detectOsGroupMock).not.toHaveBeenCalled();
      expect(saveLocalConfigMock).not.toHaveBeenCalled();
    });

    // Regression: a shared `.tuckrc.json` committed with `defaultGroups` used
    // to silently suppress the per-host prompt on every fresh clone (the
    // value rode along via git). The prompt must now fire based on the LOCAL
    // file alone — shared values are inputs to the select list, not a
    // suppression signal.
    it('still prompts when only SHARED has defaultGroups (fresh-host bug)', async () => {
      pathExistsMock.mockResolvedValue(false);
      loadConfigMock.mockResolvedValue({ defaultGroups: ['kubuntu'] });
      loadLocalConfigMock.mockResolvedValue({});
      detectOsGroupMock.mockResolvedValueOnce('ubuntu');
      getAllGroupsMock.mockResolvedValueOnce(['kali', 'kubuntu']);
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const ui = await import('../../src/ui/index.js');
      (ui.prompts.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('__skip__');
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        expect(ui.prompts.select).toHaveBeenCalled();
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });

    it('skips silently when nothing detected and no repo groups', async () => {
      pathExistsMock.mockResolvedValue(false);
      detectOsGroupMock.mockResolvedValueOnce(null);
      getAllGroupsMock.mockResolvedValueOnce([]);
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        const ui = await import('../../src/ui/index.js');
        expect(ui.prompts.select).not.toHaveBeenCalled();
        expect(saveLocalConfigMock).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });

    it('logs advisory and skips save on non-TTY (CI)', async () => {
      pathExistsMock.mockResolvedValue(false);
      detectOsGroupMock.mockResolvedValueOnce('kali');
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        expect(saveLocalConfigMock).not.toHaveBeenCalled();
        expect(promptsLogInfoMock).toHaveBeenCalledWith(
          expect.stringContaining('Detected OS: kali')
        );
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });

    it('non-TTY logs repo-groups advisory when detection empty but manifest has groups', async () => {
      pathExistsMock.mockResolvedValue(false);
      detectOsGroupMock.mockResolvedValueOnce(null);
      getAllGroupsMock.mockResolvedValueOnce(['kali', 'kubuntu']);
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        expect(saveLocalConfigMock).not.toHaveBeenCalled();
        expect(promptsLogInfoMock).toHaveBeenCalledWith(
          expect.stringContaining('Repo groups: kali, kubuntu')
        );
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });

    it('saves the chosen existing manifest group when user picks from the list', async () => {
      pathExistsMock.mockResolvedValue(false);
      detectOsGroupMock.mockResolvedValueOnce('ubuntu');
      getAllGroupsMock.mockResolvedValueOnce(['kali', 'kubuntu']);
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const ui = await import('../../src/ui/index.js');
      (ui.prompts.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('kubuntu');
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        const selectCall = (ui.prompts.select as ReturnType<typeof vi.fn>).mock.calls[0];
        const options = selectCall[1] as Array<{ value: string; label: string; hint?: string }>;
        expect(options.map((o) => o.value)).toEqual([
          'ubuntu',
          'kali',
          'kubuntu',
          '__custom__',
          '__skip__',
        ]);
        expect(options[0].hint).toBe('detected');
        expect(saveLocalConfigMock).toHaveBeenCalledWith({ defaultGroups: ['kubuntu'] });
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });

    it('prompts for custom name and saves the entered value', async () => {
      pathExistsMock.mockResolvedValue(false);
      detectOsGroupMock.mockResolvedValueOnce('ubuntu');
      getAllGroupsMock.mockResolvedValueOnce([]);
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const ui = await import('../../src/ui/index.js');
      (ui.prompts.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('__custom__');
      (ui.prompts.text as ReturnType<typeof vi.fn>).mockResolvedValueOnce('kubuntu');
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        expect(ui.prompts.text).toHaveBeenCalled();
        expect(saveLocalConfigMock).toHaveBeenCalledWith({ defaultGroups: ['kubuntu'] });
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });

    it('does not write when user picks Skip', async () => {
      pathExistsMock.mockResolvedValue(false);
      detectOsGroupMock.mockResolvedValueOnce('ubuntu');
      getAllGroupsMock.mockResolvedValueOnce([]);
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const ui = await import('../../src/ui/index.js');
      (ui.prompts.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('__skip__');
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        expect(saveLocalConfigMock).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });

    it('deduplicates detected OS against manifest groups (detected wins)', async () => {
      pathExistsMock.mockResolvedValue(false);
      detectOsGroupMock.mockResolvedValueOnce('kali');
      getAllGroupsMock.mockResolvedValueOnce(['kali', 'kubuntu']);
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const ui = await import('../../src/ui/index.js');
      (ui.prompts.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce('kali');
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        const selectCall = (ui.prompts.select as ReturnType<typeof vi.fn>).mock.calls[0];
        const options = selectCall[1] as Array<{ value: string; label: string; hint?: string }>;
        const kaliEntries = options.filter((o) => o.value === 'kali');
        expect(kaliEntries).toHaveLength(1);
        expect(kaliEntries[0].hint).toBe('detected');
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });
  });

  // ========== TASK-RB-UNIFY-IMPL init --from tail prompt ==========

  describe('restore --bootstrap tail prompt on init --from', () => {
    it('TTY + group set: prompts y/n and invokes runRestore on yes', async () => {
      pathExistsMock.mockResolvedValue(false);
      // Group already persisted (user previously answered the os-group prompt
      // or defaultGroups was seeded on a prior run). loadConfig is called twice:
      // once inside maybePromptForOsGroup (sees the group → skips its own
      // prompt), once inside maybePromptRestoreBootstrap (reads the group).
      loadConfigMock.mockResolvedValue({ defaultGroups: ['kubuntu'] });
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const ui = await import('../../src/ui/index.js');
      (ui.prompts.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        expect(ui.prompts.confirm).toHaveBeenCalledWith(
          expect.stringContaining("Run 'tuck restore --bootstrap -g kubuntu'"),
          true
        );
        expect(runRestoreMock).toHaveBeenCalledWith({
          all: true,
          bootstrap: true,
          group: ['kubuntu'],
        });
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });

    it('TTY + group set + user answers No: logs skip hint, does not invoke runRestore', async () => {
      pathExistsMock.mockResolvedValue(false);
      loadConfigMock.mockResolvedValue({ defaultGroups: ['kubuntu'] });
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const ui = await import('../../src/ui/index.js');
      (ui.prompts.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        expect(runRestoreMock).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });

    it('non-TTY + group set: prints the restore --bootstrap hint, no prompt, no runRestore', async () => {
      pathExistsMock.mockResolvedValue(false);
      loadConfigMock.mockResolvedValue({ defaultGroups: ['kubuntu'] });
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      const ui = await import('../../src/ui/index.js');
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        expect(ui.prompts.confirm).not.toHaveBeenCalled();
        expect(runRestoreMock).not.toHaveBeenCalled();
        expect(promptsLogInfoMock).toHaveBeenCalledWith(
          expect.stringContaining('tuck restore --bootstrap -g kubuntu')
        );
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });

    it('no group persisted: falls back to the plain `tuck restore --all` hint', async () => {
      pathExistsMock.mockResolvedValue(false);
      // Default loadConfigMock returns defaultGroups: [] — no group to target.
      const { runInit } = await import('../../src/commands/init.js');
      await runInit({ from: 'https://github.com/acme/dotfiles.git' });
      expect(runRestoreMock).not.toHaveBeenCalled();
      expect(promptsLogInfoMock).toHaveBeenCalledWith('Run `tuck restore --all` to restore dotfiles');
    });
  });
});
