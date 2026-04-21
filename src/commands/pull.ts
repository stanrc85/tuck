import { Command } from 'commander';
import { prompts, logger, withSpinner, colors as c } from '../ui/index.js';
import { getTuckDir } from '../lib/paths.js';
import { loadManifest, assertMigrated } from '../lib/manifest.js';
import { checkLocalMode, showLocalModeWarningForPull } from '../lib/remoteChecks.js';
import {
  pull,
  fetch,
  hasRemote,
  getRemoteUrl,
  getStatus,
  getCurrentBranch,
  getAheadBehind,
  resetHard,
} from '../lib/git.js';
import { NotInitializedError, GitError, DivergenceError } from '../errors.js';
import type { PullOptions } from '../types.js';

const runInteractivePull = async (tuckDir: string): Promise<void> => {
  prompts.intro('tuck pull');

  // Check for local-only mode
  if (await checkLocalMode(tuckDir)) {
    await showLocalModeWarningForPull();
    prompts.outro('');
    return;
  }

  // Check if remote exists
  const hasRemoteRepo = await hasRemote(tuckDir);
  if (!hasRemoteRepo) {
    prompts.log.error('No remote configured');
    prompts.note("Run 'tuck init -r <url>' or add a remote manually", 'Tip');
    return;
  }

  // Fetch first to get latest remote status
  await withSpinner('Fetching...', async () => {
    await fetch(tuckDir);
  });

  // Get current status
  const status = await getStatus(tuckDir);
  const branch = await getCurrentBranch(tuckDir);
  const remoteUrl = await getRemoteUrl(tuckDir);

  // Show status
  console.log();
  console.log(c.dim('Remote:'), remoteUrl);
  console.log(c.dim('Branch:'), branch);

  if (status.behind === 0) {
    prompts.log.success('Already up to date');
    return;
  }

  console.log(c.dim('Commits:'), c.yellow(`↓ ${status.behind} to pull`));

  if (status.ahead > 0) {
    console.log(
      c.dim('Note:'),
      c.yellow(`You also have ${status.ahead} local commit${status.ahead > 1 ? 's' : ''} to push`)
    );
  }

  // Check for local changes
  if (status.modified.length > 0 || status.staged.length > 0) {
    console.log();
    prompts.log.warning('You have uncommitted changes');
    console.log(c.dim('Modified:'), status.modified.join(', '));

    const continueAnyway = await prompts.confirm('Pull anyway? (may cause merge conflicts)');
    if (!continueAnyway) {
      prompts.cancel("Commit or stash your changes first with 'tuck sync'");
      return;
    }
  }

  console.log();

  // Ask about rebase
  const useRebase = await prompts.confirm('Use rebase instead of merge?');

  // Pull
  await withSpinner('Pulling...', async () => {
    await pull(tuckDir, { rebase: useRebase });
  });

  prompts.log.success('Pulled successfully!');

  // Ask about restore
  const shouldRestore = await prompts.confirm('Restore updated dotfiles to system?', true);
  if (shouldRestore) {
    prompts.note("Run 'tuck restore --all' to restore all dotfiles", 'Next step');
  }

  prompts.outro('');
};

const runPull = async (options: PullOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  // Verify tuck is initialized
  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);

  // Check for local-only mode
  if (await checkLocalMode(tuckDir)) {
    throw new GitError(
      'Cannot pull in local-only mode',
      "Run 'tuck config remote' to configure a remote repository"
    );
  }

  // If no options, run interactive
  if (!options.rebase && !options.restore && !options.mirror) {
    await runInteractivePull(tuckDir);
    return;
  }

  // Check if remote exists
  const hasRemoteRepo = await hasRemote(tuckDir);
  if (!hasRemoteRepo) {
    throw new GitError('No remote configured', "Run 'tuck init -r <url>' or add a remote manually");
  }

  // Fetch first
  await withSpinner('Fetching...', async () => {
    await fetch(tuckDir);
  });

  // Divergence gate (same policy as `tuck update`): fail fast when
  // ahead>0 AND (behind>0 OR mirror). Without the gate, `--mirror` would
  // silently destroy local commits and `--rebase` would hit conflicts.
  const { ahead, behind } = await getAheadBehind(tuckDir);
  if (!options.allowDivergent) {
    if (ahead > 0 && behind > 0) {
      throw new DivergenceError(ahead, behind);
    }
    if (ahead > 0 && options.mirror) {
      throw new DivergenceError(ahead, behind);
    }
  }

  if (options.mirror) {
    await withSpinner('Resetting to upstream...', async () => {
      await resetHard(tuckDir, '@{u}');
    });
    logger.success('Reset to upstream.');
  } else {
    await withSpinner('Pulling...', async () => {
      await pull(tuckDir, { rebase: options.rebase });
    });
    logger.success('Pulled successfully!');
  }

  if (options.restore) {
    logger.info("Run 'tuck restore --all' to restore dotfiles");
  }
};

export const pullCommand = new Command('pull')
  .description('Pull changes from remote')
  .option('--rebase', 'Pull with rebase')
  .option('--restore', 'Also restore files to system after pull')
  .option('--mirror', 'Reset to upstream (destroys local commits) — use on receiving-only hosts')
  .option('--allow-divergent', 'Bypass the divergence safety check (required with --mirror when ahead of upstream)')
  .action(async (options: PullOptions) => {
    await runPull(options);
  });
