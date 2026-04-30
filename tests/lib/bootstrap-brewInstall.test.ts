import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

interface FakeChild extends EventEmitter {
  kill: (signal?: string) => boolean;
}

const makeChild = (script: { error?: Error; exitCode?: number | null }): FakeChild => {
  const child = new EventEmitter() as FakeChild;
  child.kill = vi.fn(() => true);
  setImmediate(() => {
    if (script.error) {
      child.emit('error', script.error);
    } else {
      child.emit('exit', script.exitCode ?? 0);
    }
  });
  return child;
};

/** Child that never emits `exit` until manually triggered — for timeout tests. */
const makeHangingChild = (): FakeChild & { triggerKilled: () => void } => {
  const child = new EventEmitter() as FakeChild & { triggerKilled: () => void };
  child.kill = vi.fn(() => {
    // Simulate the SIGTERM landing — emit `exit` with null code.
    setImmediate(() => child.emit('exit', null));
    return true;
  });
  child.triggerKilled = (): void => {
    child.emit('exit', null);
  };
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

  it('memoizes the brew availability probe across multiple installs', async () => {
    // First call: --version probe + install spawn = 2.
    // Second call: install spawn only (no --version probe) = 1.
    // Total: 3 spawns for 2 installs.
    spawnMock
      .mockImplementationOnce(() => makeChild({ exitCode: 0 })) // --version
      .mockImplementationOnce(() => makeChild({ exitCode: 0 })) // install fzf
      .mockImplementationOnce(() => makeChild({ exitCode: 0 })); // install bat

    const attemptBrewInstall = await importAttempt();
    await attemptBrewInstall('fzf');
    await attemptBrewInstall('bat');

    expect(spawnMock).toHaveBeenCalledTimes(3);
  });

  it('kills the install and returns failed with a "timed out" message when brew hangs', async () => {
    vi.useFakeTimers();
    try {
      let installChild: ReturnType<typeof makeHangingChild>;
      spawnMock
        .mockImplementationOnce(() => makeChild({ exitCode: 0 })) // --version
        .mockImplementationOnce(() => {
          installChild = makeHangingChild();
          return installChild;
        });

      const attemptBrewInstall = await importAttempt();
      const promise = attemptBrewInstall('fzf');

      // Advance past the 5-minute install timeout. The timer fires, the
      // module sends SIGTERM, our fake child emits `exit` in response.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

      const result = await promise;
      expect(result.status).toBe('failed');
      expect(result.message).toMatch(/timed out/);
      expect(installChild!.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });
});
