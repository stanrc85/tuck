import { Command } from 'commander';
import {
  prompts,
  withSpinner,
  isInteractive,
  formatCount,
  colors as c,
} from '../ui/index.js';
import { getTuckDir, collapsePath } from '../lib/paths.js';
import { loadManifest, assertMigrated } from '../lib/manifest.js';
import { scanOrphans, deleteOrphans, type OrphanScanResult } from '../lib/clean.js';
import { formatFileSize } from '../lib/files.js';
import { createSnapshot, pruneSnapshotsFromConfig } from '../lib/timemachine.js';
import { stageAll, commit, push, hasRemote } from '../lib/git.js';
import {
  NotInitializedError,
  GitError,
  NonInteractivePromptError,
} from '../errors.js';

const MAX_PUSH_RETRIES = 3;
const MAX_PREVIEW_ITEMS = 20;

interface CleanOptions {
  dryRun?: boolean;
  yes?: boolean;
  commit?: boolean;
  push?: boolean;
  message?: string;
}

const printScanPreview = (result: OrphanScanResult): void => {
  const { orphanFiles, orphanDirs, missingFromDisk, totalSize } = result;

  if (missingFromDisk.length > 0) {
    const lines: string[] = [];
    for (const m of missingFromDisk.slice(0, MAX_PREVIEW_ITEMS)) {
      lines.push(c.muted(`  • ${m.source}  → ${m.destination}`));
    }
    if (missingFromDisk.length > MAX_PREVIEW_ITEMS) {
      lines.push(c.muted(`  … and ${missingFromDisk.length - MAX_PREVIEW_ITEMS} more`));
    }
    lines.push(c.dim("Run `tuck doctor` to diagnose and fix these."));
    prompts.log.warning(
      `${formatCount(missingFromDisk.length, 'manifest entry', 'manifest entries')} reference paths that no longer exist in the repository:`
    );
    prompts.log.message(lines.join('\n'));
  }

  if (orphanFiles.length === 0 && orphanDirs.length === 0) {
    prompts.log.success('No orphaned files — .tuck/files/ is in sync with the manifest.');
    return;
  }

  const fileLines: string[] = [
    c.bold(
      `Orphaned files (${formatCount(orphanFiles.length, 'file')}, ${formatFileSize(totalSize)}):`
    ),
  ];
  for (const f of orphanFiles.slice(0, MAX_PREVIEW_ITEMS)) {
    fileLines.push(
      `  ${c.muted('•')} ${f.relativePath} ${c.muted(`(${formatFileSize(f.size)})`)}`
    );
  }
  if (orphanFiles.length > MAX_PREVIEW_ITEMS) {
    fileLines.push(c.muted(`  … and ${orphanFiles.length - MAX_PREVIEW_ITEMS} more`));
  }
  prompts.log.message(fileLines.join('\n'));

  if (orphanDirs.length > 0) {
    const dirLines: string[] = [
      c.bold(
        `Directories that will be removed (${formatCount(orphanDirs.length, 'directory', 'directories')}):`
      ),
    ];
    for (const d of orphanDirs.slice(0, MAX_PREVIEW_ITEMS)) {
      dirLines.push(`  ${c.muted('•')} ${collapsePath(d)}`);
    }
    if (orphanDirs.length > MAX_PREVIEW_ITEMS) {
      dirLines.push(c.muted(`  … and ${orphanDirs.length - MAX_PREVIEW_ITEMS} more`));
    }
    prompts.log.message(dirLines.join('\n'));
  }
};

const commitAndPushClean = async (
  tuckDir: string,
  fileCount: number,
  options: CleanOptions
): Promise<void> => {
  const message =
    options.message?.trim() ||
    `chore(clean): remove ${fileCount} orphaned file${fileCount === 1 ? '' : 's'}`;

  await withSpinner('Staging changes...', async () => {
    await stageAll(tuckDir);
  });

  await withSpinner('Committing cleanup...', async () => {
    await commit(tuckDir, message);
  });
  prompts.log.success(`Committed: ${message}`);

  if (!options.push) {
    return;
  }

  if (!(await hasRemote(tuckDir))) {
    throw new GitError(
      'Cannot push — no remote configured',
      "Run 'tuck config remote' to set one up, or drop --push"
    );
  }

  let attempts = 0;
  while (attempts < MAX_PUSH_RETRIES) {
    attempts++;
    try {
      await withSpinner(
        attempts === 1
          ? 'Pushing to remote...'
          : `Pushing to remote (attempt ${attempts})...`,
        async () => {
          await push(tuckDir);
        }
      );
      prompts.log.success('Pushed to remote');
      return;
    } catch (error) {
      prompts.log.error(
        `Push failed: ${error instanceof Error ? error.message : String(error)}`
      );
      if (attempts >= MAX_PUSH_RETRIES) {
        prompts.log.warning(
          `Giving up after ${MAX_PUSH_RETRIES} attempts. The commit is preserved locally — run \`tuck push\` to retry.`
        );
        return;
      }
      if (!isInteractive()) {
        prompts.log.message(
          c.dim("Non-interactive mode: not retrying. Run `tuck push` to retry later.")
        );
        return;
      }
      const retry = await prompts.confirm('Retry push?', true);
      if (!retry) {
        prompts.log.message(
          c.dim("Commit preserved locally. Run `tuck push` to retry when ready.")
        );
        return;
      }
    }
  }
};

export const runClean = async (options: CleanOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);

  const result = await scanOrphans(tuckDir);

  prompts.intro('tuck clean');

  printScanPreview(result);

  if (result.orphanFiles.length === 0 && result.orphanDirs.length === 0) {
    prompts.outro('Nothing to clean');
    return;
  }

  if (options.dryRun) {
    prompts.outro('Dry run — re-run without --dry-run to clean');
    return;
  }

  if (!options.yes) {
    if (!isInteractive()) {
      throw new NonInteractivePromptError('tuck clean', [
        'Pass --dry-run to preview what would be removed',
        'Pass -y/--yes to skip the confirmation prompt',
      ]);
    }
    const confirmed = await prompts.confirm(
      `Delete ${formatCount(result.orphanFiles.length, 'orphaned file')}?`,
      false
    );
    if (!confirmed) {
      prompts.outro.warning('Cancelled');
      return;
    }
  }

  if (result.orphanFiles.length > 0) {
    const orphanPaths = result.orphanFiles.map((f) => f.absolutePath);
    await withSpinner('Creating snapshot before cleanup...', async () => {
      await createSnapshot(
        orphanPaths,
        `Pre-clean snapshot: removing ${result.orphanFiles.length} orphaned file${result.orphanFiles.length === 1 ? '' : 's'}`,
        { kind: 'clean' }
      );
    });
    await pruneSnapshotsFromConfig(tuckDir);
  }

  await withSpinner(
    `Removing ${formatCount(result.orphanFiles.length, 'file')}...`,
    async () => {
      await deleteOrphans(result);
    }
  );
  prompts.log.success(`Removed ${formatCount(result.orphanFiles.length, 'orphaned file')}`);
  if (result.orphanDirs.length > 0) {
    prompts.log.message(
      c.dim(
        `  and ${formatCount(result.orphanDirs.length, 'empty directory', 'empty directories')}`
      )
    );
  }

  if (options.commit || options.push) {
    await commitAndPushClean(tuckDir, result.orphanFiles.length, options);
    prompts.outro(options.push ? 'Cleaned and pushed' : 'Cleaned and committed');
  } else {
    prompts.log.message(c.dim("Run `tuck sync` to commit these changes."));
    prompts.outro(`Removed ${formatCount(result.orphanFiles.length, 'orphaned file')}`);
  }
};

export const cleanCommand = new Command('clean')
  .description('Remove orphaned files from the tuck repository')
  .option('--dry-run', 'Preview what would be removed without deleting')
  .option('-y, --yes', 'Skip the confirmation prompt')
  .option('--commit', 'Stage and commit the removal')
  .option('--push', 'Commit and push (implies --commit)')
  .option('-m, --message <msg>', 'Override the auto-generated commit message')
  .action(async (options: CleanOptions) => {
    await runClean(options);
  });
