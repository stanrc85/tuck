import { Command } from 'commander';
import { prompts, withSpinner, colors as c } from '../ui/index.js';
import { getTuckDir } from '../lib/paths.js';
import { loadManifest, assertMigrated } from '../lib/manifest.js';
import { assertHostGroupAssigned, assertHostNotReadOnly } from '../lib/groupFilter.js';
import { checkLocalMode, showLocalModeWarningForPush } from '../lib/remoteChecks.js';
import {
  push,
  hasRemote,
  getRemoteUrl,
  getStatus,
  getCurrentBranch,
  addRemote,
} from '../lib/git.js';
import { NotInitializedError, GitError } from '../errors.js';
import type { PushOptions } from '../types.js';
import { logForcePush } from '../lib/audit.js';

const toViewUrl = (remoteUrl: string | null): string | null => {
  if (!remoteUrl) return null;
  if (remoteUrl.startsWith('git@github.com:')) {
    return remoteUrl.replace('git@github.com:', 'https://github.com/').replace('.git', '');
  }
  return remoteUrl;
};

const runInteractivePush = async (tuckDir: string): Promise<void> => {
  prompts.intro('tuck push');

  if (await checkLocalMode(tuckDir)) {
    await showLocalModeWarningForPush();
    prompts.outro('Push skipped — local-only mode');
    return;
  }

  const hasRemoteRepo = await hasRemote(tuckDir);

  if (!hasRemoteRepo) {
    prompts.log.warning('No remote configured');

    const addRemoteNow = await prompts.confirm('Would you like to add a remote?');
    if (!addRemoteNow) {
      prompts.cancel('No remote to push to');
      return;
    }

    const remoteUrl = await prompts.text('Enter remote URL:', {
      placeholder: 'git@github.com:user/dotfiles.git',
      validate: (value) => {
        if (!value) return 'Remote URL is required';
        return undefined;
      },
    });

    await addRemote(tuckDir, 'origin', remoteUrl);
    prompts.log.success('Remote added');
  }

  const status = await getStatus(tuckDir);
  const branch = await getCurrentBranch(tuckDir);
  const remoteUrl = await getRemoteUrl(tuckDir);

  if (status.ahead === 0 && status.tracking) {
    prompts.outro('Already up to date with remote');
    return;
  }

  prompts.log.message(c.dim(`Remote: ${remoteUrl}\nBranch: ${branch}`));

  if (status.ahead > 0) {
    prompts.log.message(`${c.dim('Commits:')} ${c.green(`↑ ${status.ahead} to push`)}`);
  }

  if (status.behind > 0) {
    prompts.log.message(
      `${c.dim('Warning:')} ${c.yellow(`↓ ${status.behind} commits behind remote`)}`
    );

    const pullFirst = await prompts.confirm('Pull changes first?', true);
    if (pullFirst) {
      prompts.outro("Run `tuck pull` first, then push");
      return;
    }
  }

  const confirm = await prompts.confirm('Push to remote?', true);
  if (!confirm) {
    prompts.cancel('Operation cancelled');
    return;
  }

  const needsUpstream = !status.tracking;

  try {
    await withSpinner('Pushing...', async () => {
      await push(tuckDir, {
        setUpstream: needsUpstream,
        branch: needsUpstream ? branch : undefined,
      });
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes('Permission denied') || errorMsg.includes('publickey')) {
      prompts.log.error('Authentication failed');
      prompts.log.message(c.dim('Check your SSH keys with: ssh -T git@github.com'));
      prompts.log.message(c.dim('Or try switching to HTTPS: git remote set-url origin https://...'));
    } else if (errorMsg.includes('Could not resolve host') || errorMsg.includes('Network')) {
      prompts.log.error('Network error — could not reach remote');
      prompts.log.message(c.dim('Check your internet connection and try again'));
    } else if (errorMsg.includes('rejected') || errorMsg.includes('non-fast-forward')) {
      prompts.log.error('Push rejected — remote has changes');
      prompts.log.message(c.dim("Run `tuck pull` first, then push again"));
      prompts.log.message(c.dim("Or use `tuck push --force` to overwrite (use with caution)"));
    } else {
      prompts.log.error(`Push failed: ${errorMsg}`);
    }
    prompts.outro.error('Push failed');
    return;
  }

  const viewUrl = toViewUrl(remoteUrl);
  prompts.outro(viewUrl ? `Pushed → ${viewUrl}` : 'Pushed');
};

const runPush = async (options: PushOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  // Verify tuck is initialized
  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);
  await assertHostGroupAssigned(tuckDir);
  await assertHostNotReadOnly(tuckDir, { forceWrite: options.forceWrite });

  // Check for local-only mode
  if (await checkLocalMode(tuckDir)) {
    throw new GitError(
      'Cannot push in local-only mode',
      "Run 'tuck config remote' to configure a remote repository"
    );
  }

  // If no options, run interactive
  if (!options.force && !options.setUpstream) {
    await runInteractivePush(tuckDir);
    return;
  }

  // Check if remote exists
  const hasRemoteRepo = await hasRemote(tuckDir);
  if (!hasRemoteRepo) {
    throw new GitError('No remote configured', "Run 'tuck init -r <url>' or add a remote manually");
  }

  const branch = await getCurrentBranch(tuckDir);

  // Require explicit confirmation for force push (handled outside the frame
  // so the dangerous-confirm UI owns the visual context until the user agrees).
  if (options.force) {
    const confirmed = await prompts.confirmDangerous(
      'Force push will overwrite remote history.\n' +
        'This can cause data loss for collaborators and is generally discouraged.',
      'force'
    );
    if (!confirmed) {
      return;
    }
    await logForcePush(branch);
  }

  prompts.intro('tuck push');

  if (options.force) {
    prompts.log.warning('Force pushing to remote...');
  }

  try {
    await withSpinner('Pushing...', async () => {
      await push(tuckDir, {
        force: options.force,
        setUpstream: Boolean(options.setUpstream),
        branch: options.setUpstream || branch,
      });
    });
    const remoteUrl = await getRemoteUrl(tuckDir);
    const viewUrl = toViewUrl(remoteUrl);
    prompts.outro(viewUrl ? `Pushed → ${viewUrl}` : 'Pushed');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes('Permission denied') || errorMsg.includes('publickey')) {
      throw new GitError('Authentication failed', 'Check your SSH keys: ssh -T git@github.com');
    } else if (errorMsg.includes('Could not resolve host') || errorMsg.includes('Network')) {
      throw new GitError('Network error', 'Check your internet connection');
    } else if (errorMsg.includes('rejected') || errorMsg.includes('non-fast-forward')) {
      throw new GitError('Push rejected', "Run 'tuck pull' first, or use --force");
    } else {
      throw new GitError('Push failed', errorMsg);
    }
  }
};

export const pushCommand = new Command('push')
  .description('Push changes to remote repository')
  .option('-f, --force', 'Force push')
  .option('--set-upstream <name>', 'Set upstream branch')
  .option('--force-write', 'Override the readOnlyGroups consumer-host guardrail')
  .action(async (options: PushOptions) => {
    await runPush(options);
  });
