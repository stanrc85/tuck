import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

interface FakeChild extends EventEmitter {}

const makeChild = (script: { error?: Error; exitCode?: number | null }): FakeChild => {
  const child = new EventEmitter() as FakeChild;
  setImmediate(() => {
    if (script.error) {
      child.emit('error', script.error);
    } else {
      child.emit('exit', script.exitCode ?? 0);
    }
  });
  return child;
};

const importAttempt = async () =>
  (await import('../../src/lib/bootstrap/brewInstall.js')).attemptBrewInstall;

describe('attemptBrewInstall', () => {
  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
  });

  it('returns skipped with "brew not found" when the version probe errors out', async () => {
    spawnMock.mockImplementationOnce(() =>
      makeChild({ error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) })
    );

    const attemptBrewInstall = await importAttempt();
    const result = await attemptBrewInstall('fzf');

    expect(result).toEqual({
      formula: 'fzf',
      status: 'skipped',
      message: 'brew not found on PATH',
    });
    // Only the version-probe spawn fired — no install attempt.
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('returns installed on a clean exit code 0 from `brew install`', async () => {
    spawnMock
      .mockImplementationOnce(() => makeChild({ exitCode: 0 })) // --version
      .mockImplementationOnce(() => makeChild({ exitCode: 0 })); // install

    const attemptBrewInstall = await importAttempt();
    const result = await attemptBrewInstall('fzf');

    expect(result).toEqual({ formula: 'fzf', status: 'installed' });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('returns failed with the exit code in the message when brew install non-zero exits', async () => {
    spawnMock
      .mockImplementationOnce(() => makeChild({ exitCode: 0 }))
      .mockImplementationOnce(() => makeChild({ exitCode: 1 }));

    const attemptBrewInstall = await importAttempt();
    const result = await attemptBrewInstall('not-a-real-formula');

    expect(result.status).toBe('failed');
    expect(result.message).toContain('1');
  });

  it('returns failed with the spawn error message when brew install crashes', async () => {
    spawnMock
      .mockImplementationOnce(() => makeChild({ exitCode: 0 }))
      .mockImplementationOnce(() =>
        makeChild({ error: new Error('Process spawn unexpectedly aborted') })
      );

    const attemptBrewInstall = await importAttempt();
    const result = await attemptBrewInstall('fzf');

    expect(result.status).toBe('failed');
    expect(result.message).toContain('aborted');
  });
});
