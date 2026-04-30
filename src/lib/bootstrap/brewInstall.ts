import { spawn } from 'child_process';

export type BrewInstallStatus = 'installed' | 'skipped' | 'failed';

export interface BrewInstallResult {
  formula: string;
  status: BrewInstallStatus;
  /** Short user-facing reason — surfaced in the post-restore summary. */
  message?: string;
}

/** Per-install hard timeout. Long-running formulas (compile-from-source)
 *  should still finish under this; if they don't, something's stuck and
 *  we'd rather warn-and-continue than hang the whole restore.
 */
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Run `brew install <formula>` with stdio inherited so brew's own progress
 * output reaches the user's terminal (download progress, formula caveats,
 * etc.). Returns a structured result instead of throwing — caller decides
 * how to surface the outcome.
 *
 * `skipped` covers the "brew not on PATH" case so the caller can short-
 * circuit the rest of a multi-tool install batch with one warning instead
 * of N identical "command not found" errors. The brew availability probe
 * is memoized for the process lifetime; batches of 5+ tools get a single
 * `brew --version` invocation up front instead of one per tool.
 *
 * Note: brew's own exit codes don't distinguish formula-not-found from
 * network-error from compile-failed. We surface the exit code in the
 * message and let brew's stderr (already shown to the user) carry the
 * detail.
 */
export const attemptBrewInstall = async (
  formula: string
): Promise<BrewInstallResult> => {
  if (!(await isBrewAvailable())) {
    return {
      formula,
      status: 'skipped',
      message: 'brew not found on PATH',
    };
  }

  return new Promise<BrewInstallResult>((resolve) => {
    const child = spawn('brew', ['install', formula], { stdio: 'inherit' });
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, INSTALL_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        formula,
        status: 'failed',
        message: err.message,
      });
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          formula,
          status: 'failed',
          message: `timed out after ${INSTALL_TIMEOUT_MS / 1000}s`,
        });
        return;
      }
      if (code === 0) {
        resolve({ formula, status: 'installed' });
      } else {
        resolve({
          formula,
          status: 'failed',
          message: `brew exited with code ${code ?? 'null'}`,
        });
      }
    });
  });
};

// Memoize the availability probe so a batch of N tools fires `brew --version`
// once instead of N times. `null` = not yet probed; thereafter the boolean
// is the cached result. Tests reset this via `vi.resetModules()`, which
// re-imports this module and rebinds the variable.
let cachedBrewAvailable: boolean | null = null;

export const isBrewAvailable = async (): Promise<boolean> => {
  if (cachedBrewAvailable !== null) return cachedBrewAvailable;
  cachedBrewAvailable = await new Promise<boolean>((resolve) => {
    const child = spawn('brew', ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
  return cachedBrewAvailable;
};
