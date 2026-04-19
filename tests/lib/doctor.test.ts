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
});
