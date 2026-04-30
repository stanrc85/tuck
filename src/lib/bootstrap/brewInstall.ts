import { spawn } from 'child_process';

export type BrewInstallStatus = 'installed' | 'skipped' | 'failed';

export interface BrewInstallResult {
  formula: string;
  status: BrewInstallStatus;
  /** Short user-facing reason — surfaced in the post-restore summary. */
  message?: string;
}

/**
 * Run `brew install <formula>` with stdio inherited so brew's own progress
 * output reaches the user's terminal (download progress, formula caveats,
 * etc.). Returns a structured result instead of throwing — caller decides
 * how to surface the outcome.
 *
 * `skipped` covers the "brew not on PATH" case so the caller can short-
 * circuit the rest of a multi-tool install batch with one warning instead
 * of N identical "command not found" errors.
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

    child.on('error', (err) => {
      resolve({
        formula,
        status: 'failed',
        message: err.message,
      });
    });

    child.on('exit', (code) => {
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

const isBrewAvailable = async (): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const child = spawn('brew', ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
