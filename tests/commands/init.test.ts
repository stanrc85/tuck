import { describe, it, expect, vi, beforeEach } from 'vitest';

const cloneRepoMock = vi.fn();
const createManifestMock = vi.fn();
const saveConfigMock = vi.fn();
const saveLocalConfigMock = vi.fn();
const loadConfigMock = vi.fn();
const detectOsGroupMock = vi.fn();
const pathExistsMock = vi.fn();
const loggerSuccessMock = vi.fn();
const loggerInfoMock = vi.fn();

vi.mock('../../src/ui/index.js', () => ({
  banner: vi.fn(),
  nextSteps: vi.fn(),
  withSpinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  prompts: {
    intro: vi.fn(),
    outro: vi.fn(),
    text: vi.fn(),
    confirm: vi.fn(),
    select: vi.fn(),
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
    success: loggerSuccessMock,
    info: loggerInfoMock,
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    dim: vi.fn(),
    blank: vi.fn(),
  },
  colors: {
    brand: (x: string) => x,
    dim: (x: string) => x,
    bold: (x: string) => x,
  },
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
}));

vi.mock('../../src/lib/osDetect.js', () => ({
  detectOsGroup: detectOsGroupMock,
}));

vi.mock('../../src/lib/manifest.js', () => ({
  createManifest: createManifestMock,
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

describe('init command behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloneRepoMock.mockResolvedValue(undefined);
    createManifestMock.mockResolvedValue(undefined);
    saveConfigMock.mockResolvedValue(undefined);
    saveLocalConfigMock.mockResolvedValue(undefined);
    loadConfigMock.mockResolvedValue({ defaultGroups: [] });
    detectOsGroupMock.mockResolvedValue(null);
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
    expect(loggerSuccessMock).toHaveBeenCalled();
    expect(loggerInfoMock).toHaveBeenCalledWith('Run `tuck restore --all` to restore dotfiles');
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

    it('skips when defaultGroups is already populated', async () => {
      pathExistsMock.mockResolvedValue(false);
      loadConfigMock.mockResolvedValueOnce({ defaultGroups: ['ubuntu'] });
      const { runInit } = await import('../../src/commands/init.js');
      await runInit({ from: 'https://github.com/acme/dotfiles.git' });
      expect(detectOsGroupMock).not.toHaveBeenCalled();
      expect(saveLocalConfigMock).not.toHaveBeenCalled();
    });

    it('skips silently when detectOsGroup returns null (unknown / non-Linux)', async () => {
      pathExistsMock.mockResolvedValue(false);
      detectOsGroupMock.mockResolvedValueOnce(null);
      const { runInit } = await import('../../src/commands/init.js');
      await runInit({ from: 'https://github.com/acme/dotfiles.git' });
      expect(saveLocalConfigMock).not.toHaveBeenCalled();
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
        expect(loggerInfoMock).toHaveBeenCalledWith(
          expect.stringContaining('Detected OS: kali')
        );
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });

    it('writes saveLocalConfig when user confirms the prompt', async () => {
      pathExistsMock.mockResolvedValue(false);
      detectOsGroupMock.mockResolvedValueOnce('kali');
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const ui = await import('../../src/ui/index.js');
      (ui.prompts.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        expect(saveLocalConfigMock).toHaveBeenCalledWith({ defaultGroups: ['kali'] });
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });

    it('does not write when user declines the prompt', async () => {
      pathExistsMock.mockResolvedValue(false);
      detectOsGroupMock.mockResolvedValueOnce('ubuntu');
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      const ui = await import('../../src/ui/index.js');
      (ui.prompts.confirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      try {
        const { runInit } = await import('../../src/commands/init.js');
        await runInit({ from: 'https://github.com/acme/dotfiles.git' });
        expect(saveLocalConfigMock).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
      }
    });
  });
});
