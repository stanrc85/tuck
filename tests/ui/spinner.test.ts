/**
 * Spinner UI tests
 *
 * Tests the non-interactive fallback path that prevents hangs when tuck is
 * invoked from scripts, SSH sessions without -t, or any environment where
 * stdin/stdout isn't a TTY. The interactive (clack) path isn't exercised
 * here — its animation depends on raw-mode stdin which vitest doesn't provide.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const originalStdinTTY = process.stdin.isTTY;
const originalStdoutTTY = process.stdout.isTTY;
const originalNonInteractive = process.env.TUCK_NON_INTERACTIVE;

const setTTY = (stdin: boolean, stdout: boolean): void => {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdin, writable: true, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: stdout, writable: true, configurable: true });
};

const restoreTTY = (): void => {
  Object.defineProperty(process.stdin, 'isTTY', {
    value: originalStdinTTY,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(process.stdout, 'isTTY', {
    value: originalStdoutTTY,
    writable: true,
    configurable: true,
  });
};

const restoreEnv = (): void => {
  if (originalNonInteractive === undefined) {
    delete process.env.TUCK_NON_INTERACTIVE;
  } else {
    process.env.TUCK_NON_INTERACTIVE = originalNonInteractive;
  }
};

describe('spinner', () => {
  describe('isInteractive', () => {
    beforeEach(() => {
      vi.resetModules();
      delete process.env.TUCK_NON_INTERACTIVE;
    });

    afterEach(() => {
      restoreTTY();
      restoreEnv();
      vi.restoreAllMocks();
    });

    it('returns true when both stdin and stdout are TTYs', async () => {
      setTTY(true, true);
      const { isInteractive } = await import('../../src/ui/spinner.js');
      expect(isInteractive()).toBe(true);
    });

    it('returns false when stdin is not a TTY', async () => {
      setTTY(false, true);
      const { isInteractive } = await import('../../src/ui/spinner.js');
      expect(isInteractive()).toBe(false);
    });

    it('returns false when stdout is not a TTY', async () => {
      setTTY(true, false);
      const { isInteractive } = await import('../../src/ui/spinner.js');
      expect(isInteractive()).toBe(false);
    });

    it('returns false when TUCK_NON_INTERACTIVE=1 even with TTYs', async () => {
      setTTY(true, true);
      process.env.TUCK_NON_INTERACTIVE = '1';
      const { isInteractive } = await import('../../src/ui/spinner.js');
      expect(isInteractive()).toBe(false);
    });

    it('returns false when TUCK_NON_INTERACTIVE=true even with TTYs', async () => {
      setTTY(true, true);
      process.env.TUCK_NON_INTERACTIVE = 'true';
      const { isInteractive } = await import('../../src/ui/spinner.js');
      expect(isInteractive()).toBe(false);
    });
  });

  describe('withSpinner (non-TTY)', () => {
    beforeEach(() => {
      vi.resetModules();
      delete process.env.TUCK_NON_INTERACTIVE;
      setTTY(false, false);
    });

    afterEach(() => {
      restoreTTY();
      restoreEnv();
      vi.restoreAllMocks();
    });

    it('resolves with the wrapped function result without touching stdin', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { withSpinner } = await import('../../src/ui/spinner.js');

      const result = await withSpinner('working', async () => 42);

      expect(result).toBe(42);
      // Success path emits one line (the success); no prompts, no raw-mode setup.
      expect(logSpy).toHaveBeenCalled();
    });

    it('propagates errors from the wrapped function and logs fail line', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { withSpinner } = await import('../../src/ui/spinner.js');

      await expect(
        withSpinner('boom', async () => {
          throw new Error('kaboom');
        })
      ).rejects.toThrow('kaboom');

      expect(logSpy).toHaveBeenCalled();
    });

    it('completes a tight loop of many spinners without hanging', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { withSpinner } = await import('../../src/ui/spinner.js');

      // Restore's inner loop can create 2 spinners per file; simulate ~50 files.
      for (let i = 0; i < 100; i++) {
        const result = await withSpinner(`step ${i}`, async () => i * 2);
        expect(result).toBe(i * 2);
      }

      expect(logSpy).toHaveBeenCalledTimes(100);
    }, 5000);
  });

  describe('clack listener cleanup (TTY, mocked clack)', () => {
    const CLACK_EVENTS = [
      'uncaughtExceptionMonitor',
      'unhandledRejection',
      'SIGINT',
      'SIGTERM',
      'exit',
    ] as const;

    const snapshotCounts = (): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const ev of CLACK_EVENTS) {
        counts[ev] = process.listenerCount(ev);
      }
      return counts;
    };

    beforeEach(() => {
      vi.resetModules();
      delete process.env.TUCK_NON_INTERACTIVE;
      setTTY(true, true);

      // Stub clack's spinner() so it faithfully reproduces the quirk we're
      // guarding against: each factory call registers a fresh listener on each
      // of the 5 process events and never removes them. If our wrapper works,
      // listener counts stay flat across the loop.
      vi.doMock('@clack/prompts', () => ({
        spinner: () => {
          const handler = (): void => {};
          for (const ev of CLACK_EVENTS) {
            process.on(ev, handler);
          }
          return {
            start: (_text?: string) => {},
            stop: (_text?: string) => {},
            message: (_text?: string) => {},
          };
        },
      }));
    });

    afterEach(() => {
      restoreTTY();
      restoreEnv();
      vi.doUnmock('@clack/prompts');
      vi.restoreAllMocks();
    });

    it('releases process listeners after each withSpinner call', async () => {
      const { withSpinner } = await import('../../src/ui/spinner.js');
      const baseline = snapshotCounts();

      for (let i = 0; i < 20; i++) {
        await withSpinner(`step ${i}`, async () => i);
      }

      const after = snapshotCounts();
      for (const ev of CLACK_EVENTS) {
        expect(after[ev]).toBe(baseline[ev]);
      }
    });

    it('releases listeners on createSpinner().stop() without a terminal call', async () => {
      const { createSpinner } = await import('../../src/ui/spinner.js');
      const baseline = snapshotCounts();

      const spinner = createSpinner('work');
      spinner.start();
      spinner.stop();

      const after = snapshotCounts();
      for (const ev of CLACK_EVENTS) {
        expect(after[ev]).toBe(baseline[ev]);
      }
    });

    it('releases listeners even if the wrapped fn throws', async () => {
      const { withSpinner } = await import('../../src/ui/spinner.js');
      const baseline = snapshotCounts();

      for (let i = 0; i < 15; i++) {
        await expect(
          withSpinner(`step ${i}`, async () => {
            throw new Error('boom');
          })
        ).rejects.toThrow('boom');
      }

      const after = snapshotCounts();
      for (const ev of CLACK_EVENTS) {
        expect(after[ev]).toBe(baseline[ev]);
      }
    });
  });

  describe('createSpinner (non-TTY)', () => {
    beforeEach(() => {
      vi.resetModules();
      delete process.env.TUCK_NON_INTERACTIVE;
      setTTY(false, false);
    });

    afterEach(() => {
      restoreTTY();
      restoreEnv();
      vi.restoreAllMocks();
    });

    it('start + stop logs one info line when no terminal state is reached', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { createSpinner } = await import('../../src/ui/spinner.js');

      const spinner = createSpinner('initial');
      spinner.start();
      spinner.stop();

      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it('start + succeed logs exactly one success line', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { createSpinner } = await import('../../src/ui/spinner.js');

      const spinner = createSpinner();
      spinner.start('working');
      spinner.succeed('done');

      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it('text() updates current message without logging', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { createSpinner } = await import('../../src/ui/spinner.js');

      const spinner = createSpinner();
      spinner.start('step 1');
      spinner.text('step 2');
      spinner.text('step 3');
      // No logs from text() calls.
      expect(logSpy).not.toHaveBeenCalled();

      spinner.succeed();
      // Succeed uses latest text from text() since no explicit arg.
      const lastCall = logSpy.mock.calls[0];
      expect(lastCall.join(' ')).toContain('step 3');
    });
  });
});
