import { spawn, type SpawnOptions, type ChildProcess } from 'child_process';
import { BootstrapError } from '../../errors.js';
import { interpolate, type BootstrapVars } from './interpolator.js';
import type { ToolDefinition } from '../../schemas/bootstrap.schema.js';
import type { OutputContext } from '../output.js';

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
 * 2. `install`/`update` capture stdout+stderr via pipe when `outputCtx`
 *    is supplied so a log file always gets the full transcript:
 *      - stdout → log file always; terminal only when `verbose`.
 *      - stderr → log file + terminal always, so sudo prompts and error
 *        text reach the user even in default-quiet mode.
 *      - stdin stays inherited so sudo can read the password from the
 *        user's TTY directly.
 *    Without `outputCtx` the runner falls back to `stdio: 'inherit'` so
 *    callers without a context get the legacy behavior unchanged.
 *    `check` always discards its streams — a "is pet installed?" probe
 *    shouldn't splatter `pet --version` on the user's terminal.
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
  /**
   * Per-run output context. When supplied, install/update scripts run
   * with piped stdio so their full transcript lands in the log file and
   * terminal output is gated by `outputCtx.verbose`. Without it, the
   * runner inherits stdio (legacy behavior).
   */
  outputCtx?: OutputContext;
  /**
   * Optional hook fired the first time the runner detects what looks
   * like an interactive prompt (sudo password, [Y/n], etc.) on the
   * subprocess's stderr in non-verbose mode. Lets the caller pause a
   * running spinner so the prompt isn't visually clobbered. Only fired
   * when `outputCtx` is supplied AND `outputCtx.verbose` is false.
   */
  onInteractivePrompt?: () => void;
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
  // Default log destination depends on whether the caller threaded an
  // OutputContext through. With one, command-echo lines belong in the log
  // file (and the terminal only when verbose) so the per-tool spinner
  // isn't visually clobbered by `$ bash -c '...'` lines. Without one,
  // fall back to the legacy `console.log` for backwards compatibility.
  const defaultLog = options.outputCtx
    ? (line: string) => {
        options.outputCtx!.log('cmd', line);
        if (options.outputCtx!.verbose) {
          console.log(line);
        }
      }
    : (line: string) => console.log(line);
  const log = options.log ?? defaultLog;

  if (options.dryRun) {
    log(`[dry-run] ${toolId} ${phase}: ${summarize(script)}`);
    return { ok: true, exitCode: 0, signal: null };
  }

  if (scriptUsesSudo(script)) {
    if (options.autoYes) {
      await assertSudoCached(options.spawnImpl ?? spawn, toolId);
    } else {
      // Interactive: pre-cache sudo creds BEFORE the spawn. Without this,
      // the install's `sudo` call would prompt via /dev/tty while the
      // spinner is repainting on the same TTY, overwriting the prompt
      // frames-by-frame and hanging the run with no visible cue. Running
      // `sudo -v` with inherited stdio gets the prompt to the user
      // cleanly; the cache is then warm for subsequent sudo calls inside
      // the install script.
      await ensureSudoCachedInteractive(options);
    }
  }

  log(`$ ${SHELL} ${SHELL_FLAG} '${summarize(script)}'`);
  const spawnFn = options.spawnImpl ?? spawn;

  if (options.outputCtx) {
    return spawnWithTee(spawnFn, SHELL, [SHELL_FLAG, script], {
      cwd: options.cwd,
      toolId,
      phase,
      outputCtx: options.outputCtx,
      onInteractivePrompt: options.onInteractivePrompt,
    });
  }

  return spawnAndWait(spawnFn, SHELL, [SHELL_FLAG, script], {
    cwd: options.cwd,
    stdio: 'inherit',
  });
};

/**
 * Heuristic: a stderr line that ends in `:` (no trailing newline) usually
 * means a child process is waiting on stdin — sudo's `[sudo] password
 * for ...:`, brew's `Password:`, generic CLI prompts. Catches the common
 * cases without trying to enumerate every i18n form. False positives just
 * cost a single redundant spinner pause; false negatives cost a
 * mid-spinner prompt that's harder to read.
 */
const SUDO_PROMPT_RE = /\[sudo\] password|^Password:\s*$|sudo: a password is required|sorry, try again/im;
const GENERIC_PROMPT_RE = /[?:]\s*$/;

/**
 * Stderr lines matching one of these patterns are routed to the log file
 * only — they're known-benign noise that buries useful output. Add new
 * entries sparingly; a missing entry just means the user sees the line in
 * default mode, which is the safe failure shape.
 *
 * Brew families:
 *   - `Warning: <pkg> <version> already installed` — `brew install` over
 *     an already-current formula.
 *   - `<formula> is already installed and up-to-date` — `brew upgrade`
 *     noise.
 *   - `Warning: Not upgrading <pkg>, the latest version is already
 *     installed` — `brew upgrade` against a single up-to-date formula.
 *   - `==> Updating Homebrew...` / `==> Auto-updated Homebrew!` /
 *     `==> Auto-updating Homebrew...` — brew's auto-update banner that
 *     fires on every `brew install`/`upgrade` invocation. Other `==> `
 *     lines (e.g. `==> Caveats`, `==> Pouring`) are deliberately NOT
 *     filtered — those are install-time content the user should see.
 *   - `Successfully updated cache.` — brew's auto-update cache result.
 *
 * Be conservative: NEVER pattern-match `==> ` broadly — `==> Caveats`
 * carries critical post-install info that has to remain visible.
 */
const STDERR_NOISE_PATTERNS: readonly RegExp[] = [
  /^Warning: \S+ \S+ already installed\b/i,
  /^\S+ is already installed and up[- ]to[- ]date\b/i,
  /^Warning: Not upgrading \S+,?\s+the latest version is already installed\b/i,
  /^==> Updating Homebrew\.{0,3}\s*$/i,
  /^==> Auto-updating Homebrew\.{0,3}\s*$/i,
  /^==> Auto-updated Homebrew!\s*$/i,
  /^Successfully updated cache\.\s*$/i,
];

const isStderrNoise = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return STDERR_NOISE_PATTERNS.some((re) => re.test(trimmed));
};

interface TeeSpawnOptions {
  cwd?: string;
  toolId: string;
  phase: 'install' | 'update';
  outputCtx: OutputContext;
  onInteractivePrompt?: () => void;
}

/**
 * Spawn a child with piped stdout/stderr and tee both streams: stdout
 * lands in the log file (and the terminal only when verbose); stderr
 * lands in the log file AND the terminal so sudo prompts and error text
 * always reach the user. Stdin stays inherited so the user can type
 * passwords directly into the child.
 *
 * Triggers `onInteractivePrompt` on the FIRST stderr chunk that looks
 * like an interactive prompt, in non-verbose mode only — the caller uses
 * this to pause a running spinner so the prompt isn't visually clobbered.
 */
const spawnWithTee = (
  spawnFn: typeof spawn,
  cmd: string,
  args: string[],
  opts: TeeSpawnOptions
): Promise<RunResult> => {
  const { outputCtx, toolId, phase, onInteractivePrompt } = opts;
  const label = `${toolId}/${phase}`;

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnFn(cmd, args, {
        cwd: opts.cwd,
        stdio: ['inherit', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(
        new BootstrapError(
          `Failed to launch ${cmd}: ${error instanceof Error ? error.message : String(error)}`,
          [`Ensure \`${cmd}\` is installed and on your PATH`]
        )
      );
      return;
    }

    let promptPaused = false;
    const maybePauseForPrompt = (text: string): void => {
      if (promptPaused || outputCtx.verbose) return;
      if (SUDO_PROMPT_RE.test(text) || GENERIC_PROMPT_RE.test(text.replace(/\s+$/, ''))) {
        promptPaused = true;
        onInteractivePrompt?.();
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      outputCtx.log(label, text);
      if (outputCtx.verbose) {
        process.stdout.write(text);
      }
    });

    // Buffered line filter for non-verbose mode. We split stderr on
    // newline and drop lines matching a known-noise pattern; everything
    // else (including partial lines that look like prompts) gets through.
    // Verbose mode skips the filter entirely — the user opted into the
    // raw stream.
    let stderrBuffer = '';
    const handleStderrChunk = (text: string): void => {
      if (outputCtx.verbose) {
        process.stderr.write(text);
        return;
      }
      stderrBuffer += text;
      let nlIdx;
      while ((nlIdx = stderrBuffer.indexOf('\n')) !== -1) {
        const line = stderrBuffer.slice(0, nlIdx);
        stderrBuffer = stderrBuffer.slice(nlIdx + 1);
        if (!isStderrNoise(line)) {
          process.stderr.write(line + '\n');
          maybePauseForPrompt(line);
        }
      }
      // Partial line (no trailing newline) that looks like a prompt — sudo
      // writes "[sudo] password for alice: " without flushing a newline.
      // Forward eagerly so the user can respond, then clear the buffer so
      // we don't double-emit when the next chunk arrives.
      if (stderrBuffer.length > 0 && /[?:]\s*$/.test(stderrBuffer)) {
        process.stderr.write(stderrBuffer);
        maybePauseForPrompt(stderrBuffer);
        stderrBuffer = '';
      }
    };
    const flushStderrBuffer = (): void => {
      if (stderrBuffer.length === 0) return;
      // Default mode: drop trailing partial lines unconditionally. They
      // are overwhelmingly tail fragments of \r-overwriting progress
      // (e.g. brew leaves a stray "en" from a locale-warning chunk it
      // never finished writing). Forwarding them garbles the per-tool
      // spinner because clack's spinner.stop repositions the cursor
      // assuming its line is still adjacent to the previous write.
      // Real warnings/errors from apt/brew/npm always terminate with
      // a newline, so they're already forwarded by the per-line loop in
      // handleStderrChunk. Verbose mode forwards stderr raw, so this
      // branch only runs in default-quiet mode.
      if (outputCtx.verbose) {
        process.stderr.write(stderrBuffer);
      }
      stderrBuffer = '';
    };

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      outputCtx.log(label, text);
      handleStderrChunk(text);
    });

    child.on('error', (err) => {
      flushStderrBuffer();
      reject(
        new BootstrapError(`Failed to launch ${cmd}: ${err.message}`, [
          `Ensure \`${cmd}\` is installed and on your PATH`,
        ])
      );
    });

    child.on('close', (code, signal) => {
      flushStderrBuffer();
      resolve({
        ok: code === 0,
        exitCode: code,
        signal: signal as NodeJS.Signals | null,
      });
    });
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
 * Interactive counterpart to `assertSudoCached`: probe the cache, and if
 * cold, run `sudo -v` with inherited stdio so the password prompt lands
 * on the user's TTY without the spinner clobbering it. If the caller
 * supplied `onInteractivePrompt` (the spinner-pause hook), fire it before
 * the prompt so clack's animation steps out of the way.
 *
 * Throws `BootstrapError` only on hard sudo failure (wrong password,
 * account lockout, exit != 0). The caller's outcome aggregation treats
 * the throw as a fail-fast signal — better than letting the install
 * proceed and hang on a prompt the user can't see.
 */
const ensureSudoCachedInteractive = async (options: RunOptions): Promise<void> => {
  const spawnFn = options.spawnImpl ?? spawn;
  const probe = await spawnAndWait(spawnFn, 'sudo', ['-n', 'true'], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  if (probe.ok) return;

  // Cold cache. Step the spinner aside so the prompt is visible.
  options.onInteractivePrompt?.();

  const auth = await spawnAndWait(spawnFn, 'sudo', ['-v'], { stdio: 'inherit' });
  if (!auth.ok) {
    throw new BootstrapError('sudo authentication failed', [
      'Check your password and account status (e.g. lockout, sudoers entry)',
      'Re-run `tuck bootstrap update` after fixing',
    ]);
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
