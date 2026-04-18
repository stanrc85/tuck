import { Command } from 'commander';
import { prompts, logger, colors as c, formatCount } from '../ui/index.js';
import { getTuckDir, expandPath, collapsePath, pathExists } from '../lib/paths.js';
import { loadManifest, isFileTracked } from '../lib/manifest.js';
import {
  addToTuckignore,
  removeFromTuckignore,
  getIgnoredPaths,
  isIgnored,
} from '../lib/tuckignore.js';
import { NotInitializedError } from '../errors.js';

interface IgnoreAddOptions {
  force?: boolean;
}

const ensureInitialized = async (tuckDir: string): Promise<void> => {
  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
};

const runIgnoreAdd = async (paths: string[], options: IgnoreAddOptions): Promise<void> => {
  const tuckDir = getTuckDir();
  await ensureInitialized(tuckDir);

  if (paths.length === 0) {
    logger.error('At least one path is required');
    return;
  }

  let added = 0;
  let skipped = 0;
  let warnedTracked = 0;

  for (const input of paths) {
    const expanded = expandPath(input);
    const collapsed = collapsePath(expanded);

    if (await isIgnored(tuckDir, collapsed)) {
      logger.dim(`Already ignored: ${collapsed}`);
      skipped++;
      continue;
    }

    // Warn (but do not block) if the path is currently tracked. Ignoring a
    // tracked file does not untrack it — users still need to run `tuck remove`.
    if (await isFileTracked(tuckDir, collapsed)) {
      warnedTracked++;
      if (!options.force) {
        logger.warning(
          `${collapsed} is currently tracked. Adding it to .tuckignore will not untrack it.`
        );
        logger.dim(`  Run 'tuck remove ${collapsed}' to untrack, or re-run with --force to ignore without untracking.`);
        skipped++;
        continue;
      }
    }

    if (!(await pathExists(expanded))) {
      logger.dim(`Path does not exist on disk (added anyway): ${collapsed}`);
    }

    await addToTuckignore(tuckDir, collapsed);
    logger.success(`Ignored ${collapsed}`);
    added++;
  }

  logger.blank();
  if (added > 0) {
    logger.success(`Added ${formatCount(added, 'path')} to .tuckignore`);
  }
  if (skipped > 0) {
    logger.dim(`Skipped ${formatCount(skipped, 'path')}`);
  }
  if (warnedTracked > 0 && !options.force) {
    logger.info(
      `${formatCount(warnedTracked, 'tracked path')} were skipped; use --force to ignore anyway.`
    );
  }
};

const runIgnoreRemove = async (paths: string[]): Promise<void> => {
  const tuckDir = getTuckDir();
  await ensureInitialized(tuckDir);

  if (paths.length === 0) {
    logger.error('At least one path is required');
    return;
  }

  let removed = 0;
  let skipped = 0;

  for (const input of paths) {
    const expanded = expandPath(input);
    const collapsed = collapsePath(expanded);

    if (!(await isIgnored(tuckDir, collapsed))) {
      logger.dim(`Not in .tuckignore: ${collapsed}`);
      skipped++;
      continue;
    }

    await removeFromTuckignore(tuckDir, collapsed);
    logger.success(`Removed ${collapsed}`);
    removed++;
  }

  logger.blank();
  if (removed > 0) {
    logger.success(`Removed ${formatCount(removed, 'path')} from .tuckignore`);
  }
  if (skipped > 0) {
    logger.dim(`Skipped ${formatCount(skipped, 'path')}`);
  }
};

const runIgnoreList = async (): Promise<void> => {
  const tuckDir = getTuckDir();
  await ensureInitialized(tuckDir);

  const paths = await getIgnoredPaths(tuckDir);

  prompts.intro('tuck ignore');

  if (paths.length === 0) {
    prompts.log.warning('No paths are currently ignored');
    prompts.note("Run 'tuck ignore add <path>' to ignore a path", 'Tip');
    prompts.outro('');
    return;
  }

  console.log();
  for (const path of paths) {
    console.log(c.dim('  • ') + path);
  }
  console.log();
  prompts.outro(`${formatCount(paths.length, 'ignored path')}`);
};

const runInteractiveIgnore = async (): Promise<void> => {
  const tuckDir = getTuckDir();
  await ensureInitialized(tuckDir);

  prompts.intro('tuck ignore');

  const action = await prompts.select<'add' | 'rm' | 'list'>('What would you like to do?', [
    { value: 'list', label: 'List ignored paths', hint: 'Show current .tuckignore contents' },
    { value: 'add', label: 'Add paths to ignore', hint: 'Append to .tuckignore' },
    { value: 'rm', label: 'Remove paths from ignore', hint: 'Delete from .tuckignore' },
  ]);

  if (action === 'list') {
    const paths = await getIgnoredPaths(tuckDir);
    if (paths.length === 0) {
      prompts.log.warning('No paths are currently ignored');
    } else {
      console.log();
      for (const path of paths) {
        console.log(c.dim('  • ') + path);
      }
      console.log();
    }
    prompts.outro('Done!');
    return;
  }

  if (action === 'add') {
    const input = await prompts.text('Paths to ignore (space-separated):', {
      placeholder: '~/.cache ~/.local/share/nvim',
      validate: (value) => (value.trim() ? undefined : 'At least one path is required'),
    });
    const paths = input.split(/\s+/).filter(Boolean);
    await runIgnoreAdd(paths, { force: false });
    prompts.outro('Done!');
    return;
  }

  // rm
  const current = await getIgnoredPaths(tuckDir);
  if (current.length === 0) {
    prompts.log.warning('No paths to remove');
    prompts.outro('');
    return;
  }

  const selected = await prompts.multiselect(
    'Select paths to remove from .tuckignore:',
    current.map((p) => ({ value: p, label: p })),
    { required: true }
  );

  if (selected.length === 0) {
    prompts.cancel('No paths selected');
    return;
  }

  await runIgnoreRemove(selected);
  prompts.outro('Done!');
};

export const ignoreCommand = new Command('ignore')
  .description('Manage the .tuckignore file')
  .action(async () => {
    await runInteractiveIgnore();
  })
  .addCommand(
    new Command('add')
      .description('Add paths to .tuckignore')
      .argument('<paths...>', 'Paths to ignore')
      .option('-f, --force', 'Ignore even if the path is currently tracked')
      .action(async (paths: string[], options: IgnoreAddOptions) => {
        await runIgnoreAdd(paths, options);
      })
  )
  .addCommand(
    new Command('rm')
      .description('Remove paths from .tuckignore')
      .argument('<paths...>', 'Paths to un-ignore')
      .action(async (paths: string[]) => {
        await runIgnoreRemove(paths);
      })
  )
  .addCommand(
    new Command('list').description('List ignored paths').action(async () => {
      await runIgnoreList();
    })
  );
