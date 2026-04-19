import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { runDoctorChecks, getDoctorExitCode } from '../../src/lib/doctor.js';
import { getStatus } from '../../src/lib/git.js';
import { clearManifestCache } from '../../src/lib/manifest.js';
import { clearConfigCache } from '../../src/lib/config.js';
import { initTestTuck, TEST_HOME, TEST_TUCK_DIR } from '../utils/testHelpers.js';
import { createMockManifest, createMockTrackedFile } from '../utils/factories.js';

vi.mock('../../src/lib/git.js', () => ({
  getStatus: vi.fn(),
}));

const DEFAULT_GIT_STATUS = {
  isRepo: true,
  branch: 'main',
  tracking: 'origin/main',
  ahead: 0,
  behind: 0,
  staged: [],
  modified: [],
  untracked: [],
  deleted: [],
  hasChanges: false,
};

describe('doctor checks', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  beforeEach(() => {
    vol.reset();
    clearManifestCache();
    clearConfigCache();
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    vi.mocked(getStatus).mockReset();
    vi.mocked(getStatus).mockResolvedValue({ ...DEFAULT_GIT_STATUS });
  });

  afterEach(() => {
    vol.reset();
    clearManifestCache();
    clearConfigCache();
  });

  it('reports healthy status for a valid initialized repository', async () => {
    await initTestTuck();

    const report = await runDoctorChecks();

    expect(report.summary.failed).toBe(0);
    expect(report.summary.warnings).toBe(0);
    expect(report.checks.some((check) => check.id === 'repo.tuck-directory' && check.status === 'pass')).toBe(true);
    expect(report.checks.some((check) => check.id === 'repo.manifest-loadable' && check.status === 'pass')).toBe(true);
    expect(getDoctorExitCode(report)).toBe(0);
  });

  it('fails when tuck directory is missing', async () => {
    vol.mkdirSync(TEST_HOME, { recursive: true });

    const report = await runDoctorChecks();

    expect(report.summary.failed).toBeGreaterThan(0);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'repo.tuck-directory',
          status: 'fail',
        }),
      ])
    );
    expect(getDoctorExitCode(report)).toBe(1);
  });

  it('fails manifest checks when unsafe destinations exist', async () => {
    await initTestTuck();

    const manifest = createMockManifest({
      files: {
        zshrc: createMockTrackedFile({
          source: '~/.zshrc',
          destination: '../../evil',
        }),
      },
    });

    vol.writeFileSync(join(TEST_TUCK_DIR, '.tuckmanifest.json'), JSON.stringify(manifest, null, 2));
    clearManifestCache();

    const report = await runDoctorChecks({ category: 'manifest' });

    expect(report.summary.failed).toBeGreaterThan(0);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'manifest.path-safety',
          status: 'fail',
        }),
      ])
    );
  });

  it('returns strict warning exit code when warnings are present without failures', async () => {
    await initTestTuck({
      config: {
        security: {
          scanSecrets: false,
        },
      },
    });

    const report = await runDoctorChecks({ category: 'security' });

    expect(report.summary.failed).toBe(0);
    expect(report.summary.warnings).toBeGreaterThan(0);
    expect(getDoctorExitCode(report, true)).toBe(2);
  });

  it('uses OS-level home resolution when HOME and USERPROFILE are unset', async () => {
    await initTestTuck();
    delete process.env.HOME;
    delete process.env.USERPROFILE;

    const report = await runDoctorChecks({ category: 'env' });
    const homeCheck = report.checks.find((check) => check.id === 'env.home-directory');

    expect(homeCheck?.status).toBe('pass');
  });

  it('fails when tuck path exists but is not a directory', async () => {
    vol.mkdirSync(TEST_HOME, { recursive: true });
    vol.writeFileSync(TEST_TUCK_DIR, 'conflicting file');

    const report = await runDoctorChecks();
    const tuckDirCheck = report.checks.find((check) => check.id === 'repo.tuck-directory');

    expect(tuckDirCheck?.status).toBe('fail');
    expect(tuckDirCheck?.message).toContain('not a directory');
  });

  describe('tty-capability check', () => {
    const originalStdoutTty = process.stdout.isTTY;
    const originalStdinTty = process.stdin.isTTY;
    const originalNonInteractive = process.env.TUCK_NON_INTERACTIVE;

    const setTty = (stdin: boolean, stdout: boolean): void => {
      Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true });
    };

    afterEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalStdinTty,
        configurable: true,
      });
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalStdoutTty,
        configurable: true,
      });
      if (originalNonInteractive === undefined) {
        delete process.env.TUCK_NON_INTERACTIVE;
      } else {
        process.env.TUCK_NON_INTERACTIVE = originalNonInteractive;
      }
    });

    const findTtyCheck = (report: { checks: Array<{ id: string; status: string; message: string; fix?: string; details?: string }> }) =>
      report.checks.find((c) => c.id === 'env.tty-capability');

    it('passes when both stdin and stdout are TTYs', async () => {
      delete process.env.TUCK_NON_INTERACTIVE;
      setTty(true, true);

      const report = await runDoctorChecks({ category: 'env' });
      const check = findTtyCheck(report);

      expect(check?.status).toBe('pass');
      expect(check?.message).toContain('Interactive TTY detected');
    });

    it('passes when neither stdin nor stdout is a TTY (pure non-interactive)', async () => {
      delete process.env.TUCK_NON_INTERACTIVE;
      setTty(false, false);

      const report = await runDoctorChecks({ category: 'env' });
      const check = findTtyCheck(report);

      expect(check?.status).toBe('pass');
      expect(check?.message).toContain('Non-interactive shell');
    });

    it('warns when stdout is a TTY but stdin is not', async () => {
      delete process.env.TUCK_NON_INTERACTIVE;
      setTty(false, true);

      const report = await runDoctorChecks({ category: 'env' });
      const check = findTtyCheck(report);

      expect(check?.status).toBe('warn');
      expect(check?.message).toContain('stdout is a TTY but stdin is not');
      expect(check?.fix).toContain('TUCK_NON_INTERACTIVE=1');
    });

    it('warns when stdin is a TTY but stdout is not', async () => {
      delete process.env.TUCK_NON_INTERACTIVE;
      setTty(true, false);

      const report = await runDoctorChecks({ category: 'env' });
      const check = findTtyCheck(report);

      expect(check?.status).toBe('warn');
      expect(check?.message).toContain('stdin is a TTY but stdout is not');
    });

    it('passes even in mixed TTY state when TUCK_NON_INTERACTIVE is set', async () => {
      process.env.TUCK_NON_INTERACTIVE = '1';
      setTty(false, true);

      const report = await runDoctorChecks({ category: 'env' });
      const check = findTtyCheck(report);

      expect(check?.status).toBe('pass');
      expect(check?.message).toContain('TUCK_NON_INTERACTIVE');
    });

    it('honors TUCK_NON_INTERACTIVE=true (word form)', async () => {
      process.env.TUCK_NON_INTERACTIVE = 'true';
      setTty(false, true);

      const report = await runDoctorChecks({ category: 'env' });
      const check = findTtyCheck(report);

      expect(check?.status).toBe('pass');
    });

    it('surfaces env signals in the details string', async () => {
      delete process.env.TUCK_NON_INTERACTIVE;
      setTty(true, true);

      const report = await runDoctorChecks({ category: 'env' });
      const check = findTtyCheck(report);

      expect(check?.details).toContain('stdin.isTTY=true');
      expect(check?.details).toContain('stdout.isTTY=true');
      expect(check?.details).toContain('TUCK_NON_INTERACTIVE=<unset>');
    });
  });

  describe('pnpm-availability check', () => {
    const originalOrigin = process.env.TUCK_SELF_UPDATE_ORIGIN;
    const originalPath = process.env.PATH;

    afterEach(() => {
      if (originalOrigin === undefined) {
        delete process.env.TUCK_SELF_UPDATE_ORIGIN;
      } else {
        process.env.TUCK_SELF_UPDATE_ORIGIN = originalOrigin;
      }
      process.env.PATH = originalPath;
    });

    const findPnpmCheck = (report: {
      checks: Array<{ id: string; status: string; message: string; fix?: string }>;
    }) => report.checks.find((c) => c.id === 'env.pnpm-availability');

    it('passes with "not applicable" when running from a global install', async () => {
      process.env.TUCK_SELF_UPDATE_ORIGIN = 'global';

      const report = await runDoctorChecks({ category: 'env' });
      const check = findPnpmCheck(report);

      expect(check?.status).toBe('pass');
      expect(check?.message).toContain('not applicable');
    });

    it('passes when pnpm is on PATH in a dev install', async () => {
      process.env.TUCK_SELF_UPDATE_ORIGIN = 'dev';
      // PATH unchanged — tests run via pnpm so the binary is reachable.

      const report = await runDoctorChecks({ category: 'env' });
      const check = findPnpmCheck(report);

      expect(check?.status).toBe('pass');
      expect(check?.message).toMatch(/pnpm \d/);
    });

    it('warns when pnpm is missing in a dev install', async () => {
      process.env.TUCK_SELF_UPDATE_ORIGIN = 'dev';
      process.env.PATH = '/nonexistent';

      const report = await runDoctorChecks({ category: 'env' });
      const check = findPnpmCheck(report);

      expect(check?.status).toBe('warn');
      expect(check?.fix).toContain('pnpm');
    });
  });

  describe('gh-cli-availability check', () => {
    const originalPath = process.env.PATH;

    afterEach(() => {
      process.env.PATH = originalPath;
    });

    const findGhCheck = (report: {
      checks: Array<{ id: string; status: string; message: string; fix?: string }>;
    }) => report.checks.find((c) => c.id === 'env.gh-cli-availability');

    it('passes with "not applicable" when remote.mode is not github', async () => {
      await initTestTuck({ config: { remote: { mode: 'local' } } });

      const report = await runDoctorChecks({ category: 'env' });
      const check = findGhCheck(report);

      expect(check?.status).toBe('pass');
      expect(check?.message).toContain('not applicable');
    });

    it('passes without checking gh when config is absent', async () => {
      vol.mkdirSync(TEST_HOME, { recursive: true });

      const report = await runDoctorChecks({ category: 'env' });
      const check = findGhCheck(report);

      expect(check?.status).toBe('pass');
    });

    it('warns when gh is missing under github remote mode', async () => {
      await initTestTuck({ config: { remote: { mode: 'github' } } });
      process.env.PATH = '/nonexistent';

      const report = await runDoctorChecks({ category: 'env' });
      const check = findGhCheck(report);

      expect(check?.status).toBe('warn');
      expect(check?.message).toContain('not installed');
    });
  });

  describe('hooks.trust-model check', () => {
    const findTrustCheck = (report: {
      checks: Array<{ id: string; status: string; message: string; details?: string; fix?: string }>;
    }) => report.checks.find((c) => c.id === 'hooks.trust-model');

    it('passes silently when no hooks are configured', async () => {
      await initTestTuck();

      const report = await runDoctorChecks({ category: 'hooks' });
      const check = findTrustCheck(report);

      expect(check?.status).toBe('pass');
      expect(check?.message).toContain('No hooks');
    });

    it('warns with names when any hook is configured', async () => {
      await initTestTuck({
        config: {
          hooks: {
            postRestore: 'echo done',
            preSync: 'true',
          },
        },
      });

      const report = await runDoctorChecks({ category: 'hooks' });
      const check = findTrustCheck(report);

      expect(check?.status).toBe('warn');
      expect(check?.details).toContain('postRestore');
      expect(check?.details).toContain('preSync');
      expect(check?.fix).toContain('--trust-hooks');
    });

    it('ignores empty-string hook values', async () => {
      await initTestTuck({
        config: {
          hooks: {
            postRestore: '',
            preSync: '   ',
          },
        },
      });

      const report = await runDoctorChecks({ category: 'hooks' });
      const check = findTrustCheck(report);

      expect(check?.status).toBe('pass');
    });
  });

  describe('branch-tracking check', () => {
    const mockStatus = (overrides: Record<string, unknown>): void => {
      // Both checkGitStatusReadable and checkBranchTracking call getStatus —
      // use the permanent default so both see the same shape.
      vi.mocked(getStatus).mockResolvedValue({ ...DEFAULT_GIT_STATUS, ...overrides });
    };

    const findBranchCheck = (report: { checks: Array<{ id: string; status: string; message: string; fix?: string }> }) =>
      report.checks.find((c) => c.id === 'repo.branch-tracking');

    it('passes when branch is up to date with upstream', async () => {
      await initTestTuck();
      mockStatus({});

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findBranchCheck(report);

      expect(check?.status).toBe('pass');
      expect(check?.message).toContain("up to date with 'origin/main'");
    });

    it('warns when branch has no upstream configured', async () => {
      await initTestTuck();
      mockStatus({ tracking: undefined });

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findBranchCheck(report);

      expect(check?.status).toBe('warn');
      expect(check?.message).toContain('no upstream configured');
      expect(check?.fix).toContain('--set-upstream');
    });

    it('passes with details when branch is ahead only', async () => {
      await initTestTuck();
      mockStatus({ ahead: 3 });

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findBranchCheck(report);

      expect(check?.status).toBe('pass');
      expect(check?.message).toContain('3 commits ahead');
      expect(check?.details).toContain('tuck push');
    });

    it('warns when branch is behind upstream', async () => {
      await initTestTuck();
      mockStatus({ behind: 2 });

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findBranchCheck(report);

      expect(check?.status).toBe('warn');
      expect(check?.message).toContain('2 commits behind');
      expect(check?.fix).toContain('tuck pull');
    });

    it('warns when branch has diverged from upstream', async () => {
      await initTestTuck();
      mockStatus({ ahead: 2, behind: 3 });

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findBranchCheck(report);

      expect(check?.status).toBe('warn');
      expect(check?.message).toContain('diverged');
      expect(check?.message).toContain('2 ahead, 3 behind');
    });

    it('pluralizes the commit count correctly for single-commit cases', async () => {
      await initTestTuck();
      mockStatus({ behind: 1 });

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findBranchCheck(report);

      expect(check?.message).toContain('1 commit behind');
      expect(check?.message).not.toContain('1 commits');
    });

    it('skips gracefully when tuck directory is absent', async () => {
      vol.mkdirSync(TEST_HOME, { recursive: true });

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findBranchCheck(report);

      expect(check?.status).toBe('warn');
      expect(check?.message).toContain('repository is unavailable');
    });

    it('skips without double-failing when getStatus throws', async () => {
      await initTestTuck();
      vi.mocked(getStatus).mockRejectedValue(new Error('boom'));

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findBranchCheck(report);

      expect(check?.status).toBe('warn');
      expect(check?.message).toContain('could not be read');
    });
  });

  describe('legacy-default-groups check', () => {
    const findLegacyCheck = (report: {
      checks: Array<{ id: string; status: string; message: string; fix?: string; details?: string }>;
    }) => report.checks.find((c) => c.id === 'repo.legacy-default-groups');

    it('passes when shared config has no defaultGroups field', async () => {
      await initTestTuck({ config: { defaultGroups: [] } });

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findLegacyCheck(report);

      expect(check?.status).toBe('pass');
      expect(check?.message).toContain('No legacy');
    });

    it('passes when defaultGroups is an empty array', async () => {
      await initTestTuck();
      // createMockConfig sets defaultGroups: undefined by default — the raw file
      // after JSON.stringify also omits it. Assert the pass branch fires either way.
      vol.writeFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.json'),
        JSON.stringify({ repository: { path: TEST_TUCK_DIR }, defaultGroups: [] })
      );
      clearConfigCache();

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findLegacyCheck(report);

      expect(check?.status).toBe('pass');
    });

    it('warns when shared config has a non-empty defaultGroups array', async () => {
      await initTestTuck();
      vol.writeFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.json'),
        JSON.stringify({ repository: { path: TEST_TUCK_DIR }, defaultGroups: ['kali'] })
      );
      clearConfigCache();

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findLegacyCheck(report);

      expect(check?.status).toBe('warn');
      expect(check?.details).toContain('"kali"');
      expect(check?.fix).toContain('.tuckrc.local.json');
    });

    it('passes when tuck directory is absent (nothing to check)', async () => {
      vol.mkdirSync(TEST_HOME, { recursive: true });

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findLegacyCheck(report);

      expect(check?.status).toBe('pass');
    });

    it('passes without double-reporting when shared config is malformed', async () => {
      await initTestTuck();
      vol.writeFileSync(join(TEST_TUCK_DIR, '.tuckrc.json'), 'not { valid json');
      clearConfigCache();

      const report = await runDoctorChecks({ category: 'repo' });
      const legacyCheck = findLegacyCheck(report);

      // checkConfigLoadable already fails loudly on malformed JSON; this check
      // stays quiet so the user sees one clear error, not two.
      expect(legacyCheck?.status).toBe('pass');
      expect(legacyCheck?.message).toContain('Skipped');
    });

    it('surfaces all configured groups in the details string', async () => {
      await initTestTuck();
      vol.writeFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.json'),
        JSON.stringify({
          repository: { path: TEST_TUCK_DIR },
          defaultGroups: ['kali', 'work'],
        })
      );
      clearConfigCache();

      const report = await runDoctorChecks({ category: 'repo' });
      const check = findLegacyCheck(report);

      expect(check?.status).toBe('warn');
      expect(check?.details).toContain('"kali"');
      expect(check?.details).toContain('"work"');
    });
  });
});
