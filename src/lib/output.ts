import { createWriteStream, type WriteStream } from 'fs';
import { ensureDir } from 'fs-extra';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { pathExists } from './paths.js';

/**
 * Per-run output context shared by `tuck bootstrap`, `tuck bootstrap update`,
 * `tuck restore`, and `tuck update`. Always opens a log file under
 * `<tuckDir>/logs/`; the log captures full subprocess output even when the
 * default-mode terminal output is quiet. `verbose` controls whether install/
 * update subprocess stdout is also forwarded to the user's terminal.
 *
 * Lifecycle: `createOutputContext` opens the file and writes a header,
 * `close()` flushes + closes the handle. Callers should always run close()
 * in a `finally` so a thrown error doesn't leave the handle dangling.
 *
 * `logs/` is best-effort appended to the tuck repo's `.gitignore` so the
 * per-host run logs never leak into the synced dotfiles repo. Mirrors the
 * pattern used for `.tuckrc.local.json` and `.bootstrap-state.json`.
 */
export interface OutputContext {
  /** True iff the user passed `-v`/`--verbose`. */
  verbose: boolean;
  /** Absolute path to the log file for this run. */
  logPath: string;
  /** Append-mode write stream backing `logPath`. */
  logFile: WriteStream;
  /** Append a labeled line to the log file (also prepends a UTC timestamp). */
  log: (label: string, line: string) => void;
  /** Flush and close the log file. Idempotent — safe to call repeatedly. */
  close: () => Promise<void>;
}

export interface CreateOutputContextOptions {
  /** Short tag used in the log filename (e.g. 'bootstrap', 'restore'). */
  command: string;
  tuckDir: string;
  verbose: boolean;
  /** Override `new Date()` for tests. */
  now?: () => Date;
}

export const LOGS_DIRNAME = 'logs';

const formatStampForFilename = (d: Date): string =>
  d.toISOString().replace(/[:.]/g, '-');

export const createOutputContext = async (
  options: CreateOutputContextOptions
): Promise<OutputContext> => {
  const now = (options.now ?? (() => new Date()))();
  const logsDir = join(options.tuckDir, LOGS_DIRNAME);
  await ensureDir(logsDir);

  const logPath = join(logsDir, `${options.command}-${formatStampForFilename(now)}.log`);
  const logFile = createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });

  await ensureLogsGitignored(options.tuckDir);

  let closed = false;
  const ctx: OutputContext = {
    verbose: options.verbose,
    logPath,
    logFile,
    log: (label, line) => {
      const stamp = new Date().toISOString();
      const prefix = label ? `[${stamp}] [${label}] ` : `[${stamp}] `;
      logFile.write(prefix + line.replace(/\r?\n$/, '') + '\n');
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        logFile.end(() => resolve());
      });
    },
  };

  ctx.log('header', `tuck ${options.command}`);
  ctx.log('header', `verbose=${options.verbose}`);
  ctx.log('header', '─'.repeat(60));

  return ctx;
};

const LOGS_GITIGNORE_ENTRIES = ['logs/', '/logs/', 'logs'];

const ensureLogsGitignored = async (tuckDir: string): Promise<void> => {
  const gitignorePath = join(tuckDir, '.gitignore');
  let existing = '';
  if (await pathExists(gitignorePath)) {
    try {
      existing = await readFile(gitignorePath, 'utf-8');
    } catch {
      return;
    }
  }

  const lines = existing.split(/\r?\n/).map((l) => l.trim());
  if (LOGS_GITIGNORE_ENTRIES.some((entry) => lines.includes(entry))) {
    return;
  }

  const separator = existing.trim() ? '\n\n' : '';
  const updated =
    existing.trim() +
    `${separator}# Per-host run logs (never commit — local artifacts from tuck bootstrap/restore/update)\nlogs/\n`;

  try {
    await writeFile(gitignorePath, updated, 'utf-8');
  } catch {
    // best-effort — never block a real run on .gitignore flakiness
  }
};
