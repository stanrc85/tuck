import { Command } from 'commander';
import { spawn, type SpawnOptions } from 'child_process';
import { logger, withSpinner } from '../ui/index.js';
import { getTuckDir } from '../lib/paths.js';
import { loadManifest, assertMigrated } from '../lib/manifest.js';
import {
  fetch,
  pull,
  getHeadSha,
  hasRemote,
  isGitRepo,
  getAheadBehind,
  resetHard,
} from '../lib/git.js';
import { runSelfUpdate } from './self-update.js';
import { runRestore } from './restore.js';
import { runBootstrapUpdate } from './bootstrap-update.js';
import {
  NotInitializedError,
  GitError,
  TuckError,
  MigrationRequiredError,
  DivergenceError,
} from '../errors.js';

/**
 * Umbrella update command. Mirrors `deploy_dots.sh do_update()`:
 *
 *   1. tuck self-update           (unless --no-self)
 *   2. git pull (dotfiles repo)   (unless --no-pull)
 *   3. tuck restore --all         (only when dotfiles changed; unless --no-restore)
 *   4. tuck bootstrap update --all (unless --no-tools)
 *
 * If phase 1 applies an update, the command re-execs the *new* tuck
 * binary with `--no-self` + TUCK_UPDATE_RESUMED=1 so the remaining phases
 * run under the upgraded code. Without re-exec the current process would
 * still be running the old binary, which is fine for the small
 * fix-level bumps but unsafe for anything that changed the bootstrap /
 * restore surface.
 */

export interface UpdateOptions {
  /**
   * Commander convention: `--no-self` sets `self` to `false`. All four
   * phase flags default to `true` (phase runs) and are disabled via
   * `--no-<phase>`.
   */
  self?: boolean;
  pull?: boolean;
  restore?: boolean;
  tools?: boolean;
  yes?: boolean;
  /**
   * Take upstream wholesale via `git reset --hard @{u}` instead of
   * `git pull --rebase`. Treats the tuck repo as a read-only mirror on
   * this host. Destroys local commits — must be paired with an explicit
   * `--allow-divergent` to proceed when the host has unpushed work.
   */
  mirror?: boolean;
  /**
   * Bypass the divergence safety gate. Required when the local branch
   * has its own commits AND is behind upstream (classic three-way
   * divergence). Without this flag, `tuck update` fails fast with a
   * three-suggestion error instead of silently rebasing through or
   * reset-destroying.
   */
  allowDivergent?: boolean;
  /**
   * Test hook: inject a spawn implementation for the re-exec branch so we
   * don't actually fork a `tuck` subprocess in unit tests. Not wired to
   * the CLI.
   */
  spawnImpl?: typeof spawn;
  /** Test hook: override process.env TUCK_UPDATE_RESUMED gate. */
  resumed?: boolean;
}

export interface UpdateResult {
  selfUpdated: boolean;
  reExeced: boolean;
  dotfilesChanged: boolean;
  restoreRan: boolean;
  toolsRan: boolean;
  /** Exit code of the re-execed child (if re-exec happened). */
  reExecExitCode?: number;
}

const RESUME_ENV = 'TUCK_UPDATE_RESUMED';

export const runUpdate = async (options: UpdateOptions = {}): Promise<UpdateResult> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  const resumed = options.resumed ?? process.env[RESUME_ENV] === '1';
  const result: UpdateResult = {
    selfUpdated: false,
    reExeced: false,
    dotfilesChanged: false,
    restoreRan: false,
    toolsRan: false,
  };

  logger.blank();
  logger.info('tuck update — multi-phase refresh');

  // -----------------------------------------------------------------
  // Phase 1 — self-update
  // -----------------------------------------------------------------
  if (options.self !== false && !resumed) {
    logger.blank();
    logger.info('[1/4] Checking for tuck update…');
    try {
      const selfResult = await runSelfUpdate({ yes: options.yes === true });
      result.selfUpdated = selfResult.updated;
      if (selfResult.updated) {
        // Re-exec the *new* tuck binary so the remaining phases run
        // under the upgraded code. Pass --no-self to prevent an infinite
        // self-update loop and set RESUME_ENV so the child skips phase 1
        // even if --no-self is dropped somewhere.
        const childArgs = buildResumeArgs(options);
        const exitCode = await reExecAsNewTuck(childArgs, options.spawnImpl);
        result.reExeced = true;
        result.reExecExitCode = exitCode;
        // Bubble up the child's exit code. Callers that want to inspect
        // the post-self-update result can observe `reExecExitCode`.
        process.exitCode = exitCode;
        return result;
      }
    } catch (error) {
      // Self-update failures shouldn't block the rest of the update flow
      // — the user may be offline or GitHub may be flaky. Warn and
      // continue with pull + restore + tools.
      logger.warning(
        `Self-update failed: ${error instanceof Error ? error.message : String(error)}`
      );
      logger.dim('Continuing with the remaining update phases.');
    }
  } else if (resumed) {
    logger.dim('[1/4] Self-update already applied (re-exec)');
  } else {
    logger.dim('[1/4] Self-update skipped (--no-self)');
  }

  // -----------------------------------------------------------------
  // Phase 2 — pull dotfiles repo
  // -----------------------------------------------------------------
  if (options.pull !== false) {
    logger.blank();
    logger.info('[2/4] Pulling dotfiles repo…');
    result.dotfilesChanged = await pullDotfiles(tuckDir, {
      mirror: options.mirror === true,
      allowDivergent: options.allowDivergent === true,
    });
  } else {
    logger.dim('[2/4] Pull skipped (--no-pull)');
  }

  // -----------------------------------------------------------------
  // Phase 3 — restore
  // -----------------------------------------------------------------
  if (options.restore !== false && result.dotfilesChanged) {
    logger.blank();
    logger.info('[3/4] Restoring dotfiles…');
    try {
      // --all picks up config.defaultGroups via the TASK-031+035 fallback,
      // so host-scoped users get the right subset. trustHooks is on by
      // analogy with deploy_dots.sh which passes --trust-hooks.
      await runRestore({ all: true, trustHooks: true });
      result.restoreRan = true;
    } catch (error) {
      logger.warning(
        `Restore failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else if (options.restore === false) {
    logger.dim('[3/4] Restore skipped (--no-restore)');
  } else {
    logger.dim('[3/4] Dotfiles already current — skipping restore');
  }

  // -----------------------------------------------------------------
  // Phase 4 — bootstrap update
  // -----------------------------------------------------------------
  if (options.tools !== false) {
    logger.blank();
    logger.info('[4/4] Updating installed tools…');
    try {
      await runBootstrapUpdate({ all: true, yes: options.yes === true });
      result.toolsRan = true;
    } catch (error) {
      logger.warning(
        `Tool updates failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    logger.dim('[4/4] Tool updates skipped (--no-tools)');
  }

  logger.blank();
  logger.success('tuck update complete');
  return result;
};

/**
 * Runs `git fetch` + pull (rebase or mirror reset) on the tuck repo and
 * returns whether HEAD moved. Missing remote → warn + no-op; no-remote is
 * a legitimate local-only setup, not a fatal condition under `tuck update`.
 *
 * Divergence gate: after the fetch, probes ahead/behind. If ahead>0 AND
 * behind>0, throws `DivergenceError` unless `allowDivergent` is set. The
 * gate is non-negotiable in `mirror` mode (reset would destroy ahead
 * commits) and still worth having in rebase mode because rebase against a
 * diverged upstream frequently produces conflicts the user isn't expecting
 * from an ambient `tuck update` run.
 */
const pullDotfiles = async (
  tuckDir: string,
  options: { mirror: boolean; allowDivergent: boolean }
): Promise<boolean> => {
  if (!(await isGitRepo(tuckDir))) {
    logger.warning('Not a git repo — skipping pull');
    return false;
  }
  if (!(await hasRemote(tuckDir))) {
    logger.info('No remote configured — skipping pull');
    return false;
  }

  const before = await getHeadSha(tuckDir);

  try {
    await withSpinner('Fetching…', async () => {
      await fetch(tuckDir);
    });

    const { ahead, behind } = await getAheadBehind(tuckDir);
    if (ahead > 0 && behind > 0 && !options.allowDivergent) {
      throw new DivergenceError(ahead, behind);
    }
    if (ahead > 0 && options.mirror && !options.allowDivergent) {
      // Mirror mode would destroy local commits even when behind=0.
      // Require explicit override.
      throw new DivergenceError(ahead, behind);
    }

    if (options.mirror) {
      await withSpinner('Resetting to upstream…', async () => {
        await resetHard(tuckDir, '@{u}');
      });
    } else {
      await withSpinner('Pulling…', async () => {
        // --rebase matches deploy_dots.sh's reset-to-upstream semantics:
        // fast-forward when possible, don't produce merge commits from
        // ambient `tuck update` runs.
        await pull(tuckDir, { rebase: true });
      });
    }
  } catch (error) {
    if (error instanceof DivergenceError) {
      throw error;
    }
    if (error instanceof GitError) {
      logger.warning(`Pull failed: ${error.message}`);
      return false;
    }
    throw error;
  }

  const after = await getHeadSha(tuckDir);
  const changed = before !== null && after !== null && before !== after;
  if (changed) {
    logger.success(`Pulled changes (${before!.slice(0, 7)} → ${after!.slice(0, 7)})`);
  } else {
    logger.dim('No new commits.');
  }
  return changed;
};

/**
 * Build the argv passed to the re-execed `tuck update` child. Carries
 * forward every flag EXCEPT `--no-self` (we always set that for the
 * child) and the test-only hooks.
 */
const buildResumeArgs = (options: UpdateOptions): string[] => {
  const args = ['update', '--no-self'];
  if (options.pull === false) args.push('--no-pull');
  if (options.restore === false) args.push('--no-restore');
  if (options.tools === false) args.push('--no-tools');
  if (options.yes) args.push('--yes');
  if (options.mirror) args.push('--mirror');
  if (options.allowDivergent) args.push('--allow-divergent');
  return args;
};

/**
 * Spawn `tuck <args>` in the foreground and wait for it to finish. Returns
 * the child's exit code. Used to re-exec after a successful self-update so
 * the remaining phases run under the upgraded binary.
 *
 * Rationale for spawn-and-wait over real exec(): node has no POSIX
 * `execvp`, and `process.exit(code)` after a spawned child matches the
 * observable behavior closely enough.
 */
const reExecAsNewTuck = async (
  args: string[],
  spawnImpl: typeof spawn = spawn
): Promise<number> => {
  const env = { ...process.env, [RESUME_ENV]: '1' };
  const opts: SpawnOptions = { stdio: 'inherit', env };
  // Node loses argv0 over spawn, so we call the installed `tuck` binary
  // on PATH (which is the newly-installed version post-self-update).
  return new Promise<number>((resolve, reject) => {
    const child = spawnImpl('tuck', args, opts);
    child.on('error', (err) => {
      reject(
        new TuckError(
          `Failed to re-exec tuck: ${err.message}`,
          'UPDATE_REEXEC_FAILED',
          [
            'The self-update installed, but the new binary could not be launched.',
            'Run `tuck update --no-self` manually to finish the remaining phases.',
          ]
        )
      );
    });
    child.on('close', (code, signal) => {
      if (signal) {
        resolve(128); // conventional shell code for signal termination
        return;
      }
      resolve(code ?? 0);
    });
  });
};

export const updateCommand = new Command('update')
  .description('Run self-update, pull dotfiles, restore, and update tools in one shot')
  .option('--no-self', 'Skip the self-update phase')
  .option('--no-pull', 'Skip the dotfiles-repo pull phase')
  .option('--no-restore', 'Skip the dotfile restore phase')
  .option('--no-tools', 'Skip the bootstrap update phase')
  .option('-y, --yes', 'Skip confirmations in each phase')
  .option('--mirror', 'Reset to upstream (destroys local commits) instead of rebasing')
  .option('--allow-divergent', 'Bypass the divergence safety check (required with --mirror when ahead of upstream)')
  .action(async (options: UpdateOptions) => {
    // assertMigrated guards manifest shape — matches pull/restore. Let
    // MigrationRequiredError bubble (handled by the global error handler)
    // but swallow load failures so NotInitializedError comes from runUpdate.
    const tuckDir = getTuckDir();
    try {
      const manifest = await loadManifest(tuckDir);
      assertMigrated(manifest);
    } catch (error) {
      if (error instanceof MigrationRequiredError) {
        throw error;
      }
    }
    await runUpdate(options);
  });
