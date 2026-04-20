import { spawn, type SpawnOptions, type ChildProcess } from 'child_process';
import { BootstrapError } from '../../errors.js';
import { interpolate, type BootstrapVars } from './interpolator.js';
import type { ToolDefinition } from '../../schemas/bootstrap.schema.js';

/**
 * Executes `check`/`install`/`update` scripts for a single tool. Orchestration
 * (picking which tools, rolling up failures) lives in the command layer;
 * this module is intentionally narrow so it's easy to unit-test.
 *
 * Design notes:
 *
 * 1. All scripts run through `bash -c`. Install blocks in `bootstrap.toml`
 *    are shell snippets with here-docs, pipelines, command substitution —
 *    trying to parse them ourselves would be a nightmare. We assume bash
 *    is available; if it isn't, the spawn errors cleanly.
 *
 * 2. `install`/`update` inherit stdio so the user sees curl/apt output
 *    live and can type their sudo password at the prompt. `check` pipes
 *    its streams away — a "is pet installed?" probe shouldn't splatter
 *    `pet --version` on the user's terminal.
 *
 * 3. `--yes` + `sudo` handling: rather than scanning stderr for the
 *    "Password:" prompt (brittle, i18n-fragile), we pre-check with
 *    `sudo -n true` whenever the script literally contains `sudo ` and
 *    the caller set `autoYes`. If credentials aren't cached, we throw
 *    before running so the user gets one actionable message instead of
 *    a mystery hang.
 *
 * 4. `install` / `update` return `RunResult` (never throw on non-zero
 *    exit). The caller aggregates failures and decides whether to
 *    continue. Spawn-level errors (bash not found) DO throw because the
 *    whole bootstrap run is broken in that case.
 */

export interface RunOptions {
  /** Print the planned command without spawning. Returns ok: true. */
  dryRun?: boolean;
  /**
   * Caller is running non-interactively (`--yes`). When the script uses
   * `sudo`, the runner pre-checks with `sudo -n true` and fails fast if
   * credentials aren't cached.
   */
  autoYes?: boolean;
  /** Working directory for the spawned shell. Defaults to $PWD. */
  cwd?: string;
  /**
   * Override the spawn function — tests inject a mock so we don't
   * actually execute commands. Defaults to `child_process.spawn`.
   */
  spawnImpl?: typeof spawn;
  /**
   * Logger override for the `[dry-run]` and `$ bash -c "..."` lines that
   * get printed before execution. Defaults to console.log.
   */
  log?: (line: string) => void;
}

export interface RunResult {
  ok: boolean;
  /** Process exit code; null if signaled. */
  exitCode: number | null;
  /** Terminating signal, if any. */
  signal: NodeJS.Signals | null;
}

const SHELL = 'bash';
const SHELL_FLAG = '-c';

/**
 * Run `tool.check`. Exit 0 = tool is installed at the expected version.
 * Missing check → false (treat as "needs install" so the caller can still
 * offer a re-install).
 *
 * Never throws on the check script's non-zero exit — that's the whole
 * point. Does throw on bash-not-found because the whole run is broken.
 */
export const runCheck = async (
  tool: ToolDefinition,
  vars: BootstrapVars,
  options: RunOptions = {}
): Promise<boolean> => {
  if (!tool.check) {
    return false;
  }
  const rendered = interpolate(tool.check, vars);
  const spawnFn = options.spawnImpl ?? spawn;
  const result = await spawnAndWait(
    spawnFn,
    SHELL,
    [SHELL_FLAG, rendered],
    {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  return result.ok;
};

/** Run `tool.install`. See module-level notes for stdio/sudo semantics. */
export const runInstall = async (
  tool: ToolDefinition,
  vars: BootstrapVars,
  options: RunOptions = {}
): Promise<RunResult> => {
  const script = interpolate(tool.install, vars);
  return executeToolScript(tool.id, 'install', script, options);
};

/**
 * Run `tool.update`, or fall back to `tool.install` when `update` is
 * omitted or set to the `@install` sentinel (per the ticket, the common
 * case).
 */
export const runUpdate = async (
  tool: ToolDefinition,
  vars: BootstrapVars,
  options: RunOptions = {}
): Promise<RunResult> => {
  const rawScript =
    !tool.update || tool.update.trim() === '@install' ? tool.install : tool.update;
  const script = interpolate(rawScript, vars);
  return executeToolScript(tool.id, 'update', script, options);
};

const executeToolScript = async (
  toolId: string,
  phase: 'install' | 'update',
  script: string,
  options: RunOptions
): Promise<RunResult> => {
  const log = options.log ?? ((line) => console.log(line));

  if (options.dryRun) {
    log(`[dry-run] ${toolId} ${phase}: ${summarize(script)}`);
    return { ok: true, exitCode: 0, signal: null };
  }

  if (options.autoYes && scriptUsesSudo(script)) {
    await assertSudoCached(options.spawnImpl ?? spawn, toolId);
  }

  log(`$ ${SHELL} ${SHELL_FLAG} '${summarize(script)}'`);
  const spawnFn = options.spawnImpl ?? spawn;
  return spawnAndWait(spawnFn, SHELL, [SHELL_FLAG, script], {
    cwd: options.cwd,
    stdio: 'inherit',
  });
};

/**
 * `sudo -n true` succeeds iff cached credentials exist AND the user is
 * permitted to sudo without a password for at least one command. Good
 * enough to catch the "CI machine with no NOPASSWD" case before we spawn
 * an install that will hang on a password prompt.
 */
const assertSudoCached = async (
  spawnFn: typeof spawn,
  toolId: string
): Promise<void> => {
  const result = await spawnAndWait(spawnFn, 'sudo', ['-n', 'true'], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  if (!result.ok) {
    throw new BootstrapError(
      `Tool "${toolId}" needs sudo, but no cached credentials are available under --yes`,
      [
        'Run `sudo -v` first to cache your password, then retry',
        'Or configure NOPASSWD in /etc/sudoers.d/ for the install commands',
        'Or drop --yes and answer the prompt interactively',
      ]
    );
  }
};

/**
 * Match literal `sudo` as a command word, not any substring. Handles
 * common shell prefixes: start of line, after `;`, `&&`, `||`, `|`, `(`,
 * a tab, or a newline. Misses more exotic cases (backticks, `$()` wrapping)
 * but catches the typical install.sh patterns we care about — false
 * negatives only cost us a hang-that-could-have-been-a-fail-fast.
 */
export const scriptUsesSudo = (script: string): boolean => {
  return /(^|[\n\t;&|(]|\s)sudo\s/m.test(script);
};

const summarize = (script: string, max = 80): string => {
  const oneLine = script.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + '…';
};

const spawnAndWait = (
  spawnFn: typeof spawn,
  cmd: string,
  args: string[],
  opts: SpawnOptions
): Promise<RunResult> => {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnFn(cmd, args, opts);
    } catch (error) {
      reject(
        new BootstrapError(
          `Failed to launch ${cmd}: ${error instanceof Error ? error.message : String(error)}`,
          [`Ensure \`${cmd}\` is installed and on your PATH`]
        )
      );
      return;
    }

    child.on('error', (err) => {
      reject(
        new BootstrapError(`Failed to launch ${cmd}: ${err.message}`, [
          `Ensure \`${cmd}\` is installed and on your PATH`,
        ])
      );
    });

    child.on('close', (code, signal) => {
      resolve({
        ok: code === 0,
        exitCode: code,
        signal: signal as NodeJS.Signals | null,
      });
    });
  });
};
