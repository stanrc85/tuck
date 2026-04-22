import { basename } from 'path';
import { Command } from 'commander';
import { prompts, logger, withSpinner } from '../ui/index.js';
import {
  getTuckDir,
  expandPath,
  collapsePath,
  pathExists,
  validateSafeSourcePath,
  getSafeRepoPathFromDestination,
} from '../lib/paths.js';
import {
  loadManifest,
  removeFileFromManifest,
  getTrackedFileBySource,
  getAllTrackedFiles,
  assertMigrated,
} from '../lib/manifest.js';
import { deleteFileOrDir } from '../lib/files.js';
import { createSnapshot, pruneSnapshotsFromConfig } from '../lib/timemachine.js';
import { stageAll, commit, push, hasRemote } from '../lib/git.js';
import { assertHostNotReadOnly } from '../lib/groupFilter.js';
import { NotInitializedError, FileNotTrackedError, GitError } from '../errors.js';
import type { RemoveOptions } from '../types.js';

const MAX_PUSH_RETRIES = 3;

const buildDefaultCommitMessage = (files: FileToRemove[]): string => {
  if (files.length === 1) {
    return `chore(untrack): ${basename(files[0].source)}`;
  }
  const names = files.map((f) => basename(f.source)).slice(0, 3);
  const tail = files.length > 3 ? `, +${files.length - 3} more` : '';
  return `chore(untrack): ${names.join(', ')}${tail}`;
};

interface FileToRemove {
  id: string;
  source: string;
  destination: string;
}

const validateAndPrepareFiles = async (
  paths: string[],
  tuckDir: string
): Promise<FileToRemove[]> => {
  const filesToRemove: FileToRemove[] = [];

  for (const path of paths) {
    const expandedPath = expandPath(path);
    const collapsedPath = collapsePath(expandedPath);

    // Check if tracked
    const tracked = await getTrackedFileBySource(tuckDir, collapsedPath);
    if (!tracked) {
      throw new FileNotTrackedError(path);
    }

    validateSafeSourcePath(tracked.file.source);

    filesToRemove.push({
      id: tracked.id,
      source: tracked.file.source,
      destination: getSafeRepoPathFromDestination(tuckDir, tracked.file.destination),
    });
  }

  return filesToRemove;
};

const removeFiles = async (
  filesToRemove: FileToRemove[],
  tuckDir: string,
  options: RemoveOptions
): Promise<void> => {
  const shouldDelete = options.delete || options.push;

  // Pre-remove Time Machine snapshot of the repo-side copies that are about
  // to be deleted. Only relevant when the user asked us to also delete the
  // repo file (--delete or --push); plain untrack leaves .tuck/files/ alone.
  if (shouldDelete) {
    const repoPathsToSnapshot: string[] = [];
    for (const file of filesToRemove) {
      if (await pathExists(file.destination)) {
        repoPathsToSnapshot.push(file.destination);
      }
    }
    if (repoPathsToSnapshot.length > 0) {
      await withSpinner('Creating snapshot before removal...', async () => {
        await createSnapshot(
          repoPathsToSnapshot,
          `Pre-remove snapshot: ${repoPathsToSnapshot.length} file${repoPathsToSnapshot.length === 1 ? '' : 's'}`,
          { kind: 'remove' }
        );
      });
      await pruneSnapshotsFromConfig(tuckDir);
    }
  }

  for (const file of filesToRemove) {
    // Remove from manifest
    await removeFileFromManifest(tuckDir, file.id);

    // Delete from repository if requested (or implied by --push).
    // Note: source path on the host is deliberately left alone.
    if (shouldDelete) {
      if (await pathExists(file.destination)) {
        await withSpinner(`Deleting ${file.source} from repository...`, async () => {
          await deleteFileOrDir(file.destination);
        });
      }
    }

    logger.success(`Removed ${file.source} from tracking`);
    if (shouldDelete) {
      logger.dim('  Also deleted from repository');
    }
  }
};

/**
 * Commit the post-removal state and push, with retries on push failure. The
 * commit is kept regardless of push outcome so users can recover and push
 * later. Up to MAX_PUSH_RETRIES attempts are offered via interactive prompt
 * before giving up.
 */
const commitAndPushRemoval = async (
  tuckDir: string,
  filesToRemove: FileToRemove[],
  options: RemoveOptions
): Promise<void> => {
  if (!(await hasRemote(tuckDir))) {
    throw new GitError(
      'Cannot push — no remote configured',
      "Run 'tuck config remote' to set one up, or drop --push"
    );
  }

  const message = options.message?.trim() || buildDefaultCommitMessage(filesToRemove);

  await withSpinner('Staging changes...', async () => {
    await stageAll(tuckDir);
  });

  await withSpinner('Committing removal...', async () => {
    await commit(tuckDir, message);
  });
  logger.success(`Committed: ${message}`);

  let attempts = 0;
  while (attempts < MAX_PUSH_RETRIES) {
    attempts++;
    try {
      await withSpinner(
        attempts === 1 ? 'Pushing to remote...' : `Pushing to remote (attempt ${attempts})...`,
        async () => {
          await push(tuckDir);
        }
      );
      logger.success('Pushed to remote');
      return;
    } catch (error) {
      logger.error(`Push failed: ${error instanceof Error ? error.message : String(error)}`);
      if (attempts >= MAX_PUSH_RETRIES) {
        logger.warning(
          `Giving up after ${MAX_PUSH_RETRIES} attempts. The commit is preserved locally — run 'tuck push' to retry.`
        );
        return;
      }
      const retry = await prompts.confirm('Retry push?', true);
      if (!retry) {
        logger.info("Commit preserved locally. Run 'tuck push' to retry when ready.");
        return;
      }
    }
  }
};

const runInteractiveRemove = async (tuckDir: string): Promise<void> => {
  prompts.intro('tuck remove');

  // Get all tracked files
  const trackedFiles = await getAllTrackedFiles(tuckDir);
  const fileEntries = Object.entries(trackedFiles);

  if (fileEntries.length === 0) {
    prompts.log.warning('No files are currently tracked');
    prompts.outro('');
    return;
  }

  // Let user select files to remove
  const selectedFiles = await prompts.multiselect(
    'Select files to stop tracking:',
    fileEntries.map(([id, file]) => ({
      value: id,
      label: file.source,
      hint: file.category,
    })),
    { required: true }
  );

  if (selectedFiles.length === 0) {
    prompts.cancel('No files selected');
    return;
  }

  // Ask if they want to delete from repo
  const shouldDelete = await prompts.confirm('Also delete files from repository?');

  // Offer the one-shot delete-and-push flow when a remote is configured.
  let shouldPush = false;
  if (shouldDelete && (await hasRemote(tuckDir))) {
    shouldPush = await prompts.confirm('Also push the removal to remote?', false);
  }

  // Confirm
  const confirm = await prompts.confirm(
    `Remove ${selectedFiles.length} ${selectedFiles.length === 1 ? 'file' : 'files'} from tracking?`,
    true
  );

  if (!confirm) {
    prompts.cancel('Operation cancelled');
    return;
  }

  // Prepare files to remove
  const filesToRemove: FileToRemove[] = selectedFiles.map((id) => {
    const file = trackedFiles[id as string];
    validateSafeSourcePath(file.source);
    return {
      id: id as string,
      source: file.source,
      destination: getSafeRepoPathFromDestination(tuckDir, file.destination),
    };
  });

  // Remove files
  await removeFiles(filesToRemove, tuckDir, {
    delete: shouldDelete,
    push: shouldPush,
  });

  if (shouldPush) {
    await commitAndPushRemoval(tuckDir, filesToRemove, { push: true });
    prompts.outro(
      `Removed ${selectedFiles.length} ${selectedFiles.length === 1 ? 'file' : 'files'} and pushed`
    );
    return;
  }

  prompts.outro(`Removed ${selectedFiles.length} ${selectedFiles.length === 1 ? 'file' : 'files'}`);
  logger.info("Run 'tuck sync' to commit changes");
};

export const runRemove = async (paths: string[], options: RemoveOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  // Verify tuck is initialized
  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);
  await assertHostNotReadOnly(tuckDir, { forceWrite: options.forceWrite });

  if (paths.length === 0) {
    await runInteractiveRemove(tuckDir);
    return;
  }

  // --push implies --delete.
  const effectiveOptions: RemoveOptions = options.push
    ? { ...options, delete: true }
    : options;

  // Validate and prepare files
  const filesToRemove = await validateAndPrepareFiles(paths, tuckDir);

  // Remove files
  await removeFiles(filesToRemove, tuckDir, effectiveOptions);

  logger.blank();
  logger.success(
    `Removed ${filesToRemove.length} ${filesToRemove.length === 1 ? 'item' : 'items'} from tracking`
  );

  if (effectiveOptions.push) {
    await commitAndPushRemoval(tuckDir, filesToRemove, effectiveOptions);
    return;
  }

  logger.info("Run 'tuck sync' to commit changes");
};

export const removeCommand = new Command('remove')
  .description('Stop tracking dotfiles')
  .argument('[paths...]', 'Paths to dotfiles to untrack')
  .option('--delete', 'Also delete from tuck repository')
  .option('--keep-original', "Don't restore symlinks to regular files")
  .option('--push', 'Untrack + delete from repo + commit + push (implies --delete)')
  .option('-m, --message <msg>', 'Override the auto-generated commit message (with --push)')
  .option('--force-write', 'Override the readOnlyGroups consumer-host guardrail')
  .action(async (paths: string[], options: RemoveOptions) => {
    await runRemove(paths, options);
  });
