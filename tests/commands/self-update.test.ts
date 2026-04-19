import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const fetchLatestReleaseMock = vi.fn();
const fetchReleaseByTagMock = vi.fn();
const detectInstallOriginMock = vi.fn();
const isInteractiveMock = vi.fn();
const promptConfirmMock = vi.fn();
const spawnMock = vi.fn();

vi.mock('../../src/lib/updater.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/updater.js')>();
  return {
    ...original,
    fetchLatestRelease: fetchLatestReleaseMock,
    fetchReleaseByTag: fetchReleaseByTagMock,
    detectInstallOrigin: detectInstallOriginMock,
  };
});

vi.mock('../../src/ui/index.js', () => ({
  prompts: {
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    confirm: promptConfirmMock,
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
    info: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    blank: vi.fn(),
    dim: vi.fn(),
    heading: vi.fn(),
  },
  isInteractive: isInteractiveMock,
  colors: {
    muted: (s: string) => s,
    success: (s: string) => s,
    brand: (s: string) => s,
    bold: (s: string) => s,
  },
  withSpinner: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('../../src/constants.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/constants.js')>();
  return { ...original, VERSION: '1.2.0' };
});

const mockSpawnSuccess = () => {
  const emitter = new EventEmitter();
  spawnMock.mockImplementationOnce((..._args: unknown[]) => {
    setImmediate(() => emitter.emit('close', 0));
    return emitter;
  });
  return emitter;
};

const mockSpawnFailure = (code: number) => {
  const emitter = new EventEmitter();
  spawnMock.mockImplementationOnce((..._args: unknown[]) => {
    setImmediate(() => emitter.emit('close', code));
    return emitter;
  });
  return emitter;
};

const globalOrigin = { kind: 'global' as const, packageRoot: '/usr/lib/node_modules/@prnv/tuck' };
const devOrigin = { kind: 'dev' as const, packageRoot: '/home/user/tuck' };

const releaseAt = (version: string, tarball: string | null = `https://.../v${version}/tuck.tgz`) => ({
  tag: `v${version}`,
  version,
  name: `v${version}`,
  publishedAt: '2026-04-20T00:00:00Z',
  tarballUrl: tarball,
  htmlUrl: `https://github.com/stanrc85/tuck/releases/tag/v${version}`,
});

describe('tuck self-update', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    detectInstallOriginMock.mockReturnValue(globalOrigin);
    isInteractiveMock.mockReturnValue(true);
    process.exitCode = originalExitCode;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('refuses to update a dev install', async () => {
    detectInstallOriginMock.mockReturnValue(devOrigin);
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await expect(runSelfUpdate({})).rejects.toMatchObject({
      code: 'SELF_UPDATE_DEV_INSTALL',
    });
    expect(fetchLatestReleaseMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('reports up-to-date and exits cleanly when on the latest version', async () => {
    fetchLatestReleaseMock.mockResolvedValue(releaseAt('1.2.0'));
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await runSelfUpdate({});

    expect(promptConfirmMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('--check exits 0 when up-to-date', async () => {
    fetchLatestReleaseMock.mockResolvedValue(releaseAt('1.2.0'));
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await runSelfUpdate({ check: true });

    expect(process.exitCode).toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('--check exits 1 when an update is available', async () => {
    fetchLatestReleaseMock.mockResolvedValue(releaseAt('1.3.0'));
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await runSelfUpdate({ check: true });

    expect(process.exitCode).toBe(1);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('--yes auto-accepts and runs npm install -g <tarball>', async () => {
    fetchLatestReleaseMock.mockResolvedValue(releaseAt('1.3.0'));
    mockSpawnSuccess();
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await runSelfUpdate({ yes: true });

    expect(promptConfirmMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
    // On POSIX non-root test envs, the command should be sudo npm ...; on
    // Windows it should be npm directly. Accept either shape.
    const joined = [cmd, ...args].join(' ');
    expect(joined).toContain('npm install -g https://');
    expect(joined).toContain('/v1.3.0/tuck.tgz');
  });

  it('prompts for confirmation in interactive mode and installs on accept', async () => {
    fetchLatestReleaseMock.mockResolvedValue(releaseAt('1.3.0'));
    promptConfirmMock.mockResolvedValueOnce(true);
    mockSpawnSuccess();
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await runSelfUpdate({});

    expect(promptConfirmMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('cancels the install when the user declines the prompt', async () => {
    fetchLatestReleaseMock.mockResolvedValue(releaseAt('1.3.0'));
    promptConfirmMock.mockResolvedValueOnce(false);
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await runSelfUpdate({});

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('fails fast with NonInteractivePromptError when no TTY and no --yes', async () => {
    fetchLatestReleaseMock.mockResolvedValue(releaseAt('1.3.0'));
    isInteractiveMock.mockReturnValue(false);
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await expect(runSelfUpdate({})).rejects.toMatchObject({
      code: 'NON_INTERACTIVE_PROMPT',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('--tag <tag> resolves via fetchReleaseByTag and installs even on same version', async () => {
    fetchReleaseByTagMock.mockResolvedValue(releaseAt('1.2.0'));
    mockSpawnSuccess();
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await runSelfUpdate({ yes: true, tag: 'v1.2.0' });

    expect(fetchReleaseByTagMock).toHaveBeenCalledWith('v1.2.0');
    expect(fetchLatestReleaseMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('--tag <tag> can pin to a lower (downgrade) tag', async () => {
    fetchReleaseByTagMock.mockResolvedValue(releaseAt('1.1.0'));
    mockSpawnSuccess();
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await runSelfUpdate({ yes: true, tag: 'v1.1.0' });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect([cmd, ...args].join(' ')).toContain('/v1.1.0/tuck.tgz');
  });

  it('surfaces a TuckError when npm install exits non-zero', async () => {
    fetchLatestReleaseMock.mockResolvedValue(releaseAt('1.3.0'));
    mockSpawnFailure(1);
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await expect(runSelfUpdate({ yes: true })).rejects.toMatchObject({
      code: 'SELF_UPDATE_INSTALL_FAILED',
    });
  });

  it('refuses when the release has no tuck.tgz asset', async () => {
    fetchLatestReleaseMock.mockResolvedValue(releaseAt('1.3.0', null));
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await expect(runSelfUpdate({ yes: true })).rejects.toMatchObject({
      code: 'SELF_UPDATE_NO_ASSET',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('surfaces UpdaterError network failures with wrapped code', async () => {
    const { UpdaterError } = await import('../../src/lib/updater.js');
    fetchLatestReleaseMock.mockRejectedValue(new UpdaterError('boom', 'NETWORK'));
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await expect(runSelfUpdate({})).rejects.toMatchObject({
      code: 'UPDATER_NETWORK',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('reports UpdaterError NOT_FOUND clearly for --tag lookups', async () => {
    const { UpdaterError } = await import('../../src/lib/updater.js');
    fetchReleaseByTagMock.mockRejectedValue(new UpdaterError('missing', 'NOT_FOUND'));
    const { runSelfUpdate } = await import('../../src/commands/self-update.js');

    await expect(runSelfUpdate({ tag: 'v99.0.0', yes: true })).rejects.toMatchObject({
      code: 'UPDATER_NOT_FOUND',
    });
  });
});
