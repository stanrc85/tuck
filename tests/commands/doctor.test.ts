import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const runDoctorChecksMock = vi.fn();
const getDoctorExitCodeMock = vi.fn();

const promptsIntroMock = vi.fn();
const promptsOutroMock = vi.fn();
const promptsLogSuccessMock = vi.fn();
const promptsLogWarningMock = vi.fn();
const promptsLogErrorMock = vi.fn();
const promptsLogMessageMock = vi.fn();

vi.mock('../../src/lib/doctor.js', () => ({
  DOCTOR_CATEGORIES: ['env', 'repo', 'manifest', 'security', 'hooks'],
  runDoctorChecks: runDoctorChecksMock,
  getDoctorExitCode: getDoctorExitCodeMock,
}));

vi.mock('../../src/ui/index.js', () => ({
  prompts: {
    intro: promptsIntroMock,
    outro: promptsOutroMock,
    log: {
      success: promptsLogSuccessMock,
      warning: promptsLogWarningMock,
      error: promptsLogErrorMock,
      message: promptsLogMessageMock,
    },
  },
  colors: {
    dim: (s: string) => s,
    bold: (s: string) => s,
  },
}));

describe('doctor command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = 0;
  });

  it('prints human output and sets exit code for failures', async () => {
    runDoctorChecksMock.mockResolvedValue({
      generatedAt: '2026-02-11T00:00:00.000Z',
      tuckDir: '/test-home/.tuck',
      summary: { passed: 1, warnings: 0, failed: 1 },
      checks: [
        {
          id: 'repo.tuck-directory',
          category: 'repo',
          status: 'fail',
          message: 'Missing tuck directory',
          fix: 'Run tuck init',
        },
      ],
    });
    getDoctorExitCodeMock.mockReturnValue(1);

    const { runDoctor } = await import('../../src/commands/doctor.js');

    await runDoctor({ strict: true });

    expect(promptsIntroMock).toHaveBeenCalledWith('tuck doctor');
    expect(promptsLogErrorMock).toHaveBeenCalledTimes(1);
    expect(promptsLogMessageMock).toHaveBeenCalledWith('Fix: Run tuck init');
    expect(promptsOutroMock).toHaveBeenCalledWith('1 passed, 0 warnings, 1 failed');
    expect(process.exitCode).toBe(1);
  });

  it('routes pass/warn/fail to the matching prompts.log method', async () => {
    runDoctorChecksMock.mockResolvedValue({
      generatedAt: '2026-02-11T00:00:00.000Z',
      tuckDir: '/test-home/.tuck',
      summary: { passed: 1, warnings: 1, failed: 1 },
      checks: [
        { id: 'env.node-version', category: 'env', status: 'pass', message: 'Node 20+' },
        {
          id: 'security.secrets-scan',
          category: 'security',
          status: 'warn',
          message: 'Stale baseline',
          details: 'Last scan 30 days ago',
        },
        {
          id: 'repo.remote',
          category: 'repo',
          status: 'fail',
          message: 'No remote configured',
          fix: 'Run tuck push --setup',
        },
      ],
    });
    getDoctorExitCodeMock.mockReturnValue(1);

    const { runDoctor } = await import('../../src/commands/doctor.js');

    await runDoctor();

    expect(promptsLogSuccessMock).toHaveBeenCalledTimes(1);
    expect(promptsLogWarningMock).toHaveBeenCalledTimes(1);
    expect(promptsLogErrorMock).toHaveBeenCalledTimes(1);
    expect(promptsLogMessageMock).toHaveBeenCalledTimes(2);
    expect(promptsLogMessageMock).toHaveBeenNthCalledWith(1, 'Details: Last scan 30 days ago');
    expect(promptsLogMessageMock).toHaveBeenNthCalledWith(2, 'Fix: Run tuck push --setup');
  });

  it('uses the success outro when all checks pass', async () => {
    runDoctorChecksMock.mockResolvedValue({
      generatedAt: '2026-02-11T00:00:00.000Z',
      tuckDir: '/test-home/.tuck',
      summary: { passed: 3, warnings: 0, failed: 0 },
      checks: [],
    });
    getDoctorExitCodeMock.mockReturnValue(0);

    const { runDoctor } = await import('../../src/commands/doctor.js');

    await runDoctor();

    expect(promptsOutroMock).toHaveBeenCalledWith('3 checks passed');
    expect(process.exitCode).toBe(0);
  });

  it('annotates strict-mode warnings in the outro', async () => {
    runDoctorChecksMock.mockResolvedValue({
      generatedAt: '2026-02-11T00:00:00.000Z',
      tuckDir: '/test-home/.tuck',
      summary: { passed: 2, warnings: 1, failed: 0 },
      checks: [],
    });
    getDoctorExitCodeMock.mockReturnValue(2);

    const { runDoctor } = await import('../../src/commands/doctor.js');

    await runDoctor({ strict: true });

    expect(promptsOutroMock).toHaveBeenCalledWith('2 passed, 1 warning (strict)');
    expect(process.exitCode).toBe(2);
  });

  it('prints JSON output when requested', async () => {
    const jsonSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    runDoctorChecksMock.mockResolvedValue({
      generatedAt: '2026-02-11T00:00:00.000Z',
      tuckDir: '/test-home/.tuck',
      summary: { passed: 2, warnings: 1, failed: 0 },
      checks: [],
    });
    getDoctorExitCodeMock.mockReturnValue(2);

    const { runDoctor } = await import('../../src/commands/doctor.js');

    await runDoctor({ json: true, strict: true });

    expect(jsonSpy).toHaveBeenCalledTimes(1);
    expect(promptsIntroMock).not.toHaveBeenCalled();
    expect(promptsOutroMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);

    jsonSpy.mockRestore();
  });

  it('validates category option on command parse', async () => {
    const { doctorCommand } = await import('../../src/commands/doctor.js');

    await expect(
      doctorCommand.parseAsync(['node', 'doctor', '--category', 'invalid'], { from: 'user' })
    ).rejects.toThrow('Invalid category "invalid"');
  });
});
