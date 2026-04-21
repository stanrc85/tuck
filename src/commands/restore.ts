import { Command } from 'commander';
import { join } from 'path';
import { colors as c } from '../ui/theme.js';
import { chmod, stat } from 'fs/promises';
import { prompts, logger, withSpinner, isInteractive } from '../ui/index.js';
import {
  getTuckDir,
  expandPath,
  pathExists,
  collapsePath,
  validateSafeSourcePath,
  validateSafeManifestDestination,
  validatePathWithinRoot,
} from '../lib/paths.js';
import {
  loadManifest,
  getAllTrackedFiles,
  getTrackedFileBySource,
  assertMigrated,
  fileMatchesGroups,
  getAllGroups,
} from '../lib/manifest.js';
import { loadConfig, saveLocalConfig } from '../lib/config.js';
import { copyFileOrDir, createSymlink } from '../lib/files.js';
import { resolveGroupFilter } from '../lib/groupFilter.js';
import { createSnapshot, pruneSnapshotsFromConfig } from '../lib/timemachine.js';
import { runPreRestoreHook, runPostRestoreHook, type HookOptions } from '../lib/hooks.js';
import { NotInitializedError, FileNotFoundError, NonInteractivePromptError } from '../errors.js';
import { CATEGORIES } from '../constants.js';
import type { RestoreOptions } from '../types.js';
import { restoreFiles as restoreSecrets, getSecretCount } from '../lib/secrets/index.js';
import { findMissingDeps, type MissingDep } from '../lib/bootstrap/missingDeps.js';
import { runBootstrap } from './bootstrap.js';

/**
 * Fix permissions for SSH files after restore
 * SSH requires strict permissions: 700 for directories, 600 for private files
 */
const fixSSHPermissions = async (path: string): Promise<void> => {
  const expandedPath = expandPath(path);

  // Only fix permissions for SSH files
  // Check for files inside .ssh/ directory or the .ssh directory itself
  if (!path.includes('.ssh/') && !path.endsWith('.ssh')) {
    return;
  }

  try {
    const stats = await stat(expandedPath);

    if (stats.isDirectory()) {
      // Directories should be 700
      await chmod(expandedPath, 0o700);
    } else {
      // Files should be 600
      await chmod(expandedPath, 0o600);
    }
  } catch {
    // Ignore permission errors (might be on Windows)
  }
};

/**
 * Fix GPG permissions after restore
 */
const fixGPGPermissions = async (path: string): Promise<void> => {
  const expandedPath = expandPath(path);

  // Only fix permissions for GPG files
  // Check for files inside .gnupg/ directory or the .gnupg directory itself
  if (!path.includes('.gnupg/') && !path.endsWith('.gnupg')) {
    return;
  }

  try {
    const stats = await stat(expandedPath);

    if (stats.isDirectory()) {
      await chmod(expandedPath, 0o700);
    } else {
      await chmod(expandedPath, 0o600);
    }
  } catch {
    // Ignore permission errors
  }
};

interface FileToRestore {
  id: string;
  source: string;
  destination: string;
  category: string;
  existsAtTarget: boolean;
}

interface RestoreResult {
  restoredCount: number;
  secretsRestored: number;
  unresolvedPlaceholders: string[];
  /** Absolute destination paths of files actually written (excludes dry-run + skipped). */
  restoredPaths: string[];
}

const prepareFilesToRestore = async (
  tuckDir: string,
  paths?: string[],
  filterGroups?: string[]
): Promise<FileToRestore[]> => {
  const allFiles = await getAllTrackedFiles(tuckDir);
  const filesToRestore: FileToRestore[] = [];

  if (paths && paths.length > 0) {
    // Restore specific files
    for (const path of paths) {
      const expandedPath = expandPath(path);
      const collapsedPath = collapsePath(expandedPath);

      const tracked = await getTrackedFileBySource(tuckDir, collapsedPath);
      if (!tracked) {
        throw new FileNotFoundError(`Not tracked: ${path}`);
      }

      if (!fileMatchesGroups(tracked.file, filterGroups)) continue;

      validateSafeSourcePath(tracked.file.source);
      validateSafeManifestDestination(tracked.file.destination);
      const repositoryPath = join(tuckDir, tracked.file.destination);
      validatePathWithinRoot(repositoryPath, tuckDir, 'restore source');

      filesToRestore.push({
        id: tracked.id,
        source: tracked.file.source,
        destination: repositoryPath,
        category: tracked.file.category,
        existsAtTarget: await pathExists(expandedPath),
      });
    }
  } else {
    // Restore all files
    for (const [id, file] of Object.entries(allFiles)) {
      if (!fileMatchesGroups(file, filterGroups)) continue;

      validateSafeSourcePath(file.source);
      validateSafeManifestDestination(file.destination);
      const repositoryPath = join(tuckDir, file.destination);
      validatePathWithinRoot(repositoryPath, tuckDir, 'restore source');
      const targetPath = expandPath(file.source);
      filesToRestore.push({
        id,
        source: file.source,
        destination: repositoryPath,
        category: file.category,
        existsAtTarget: await pathExists(targetPath),
      });
    }
  }

  return filesToRestore;
};

const restoreFilesInternal = async (
  tuckDir: string,
  files: FileToRestore[],
  options: RestoreOptions
): Promise<RestoreResult> => {
  const config = await loadConfig(tuckDir);
  const useSymlink = options.symlink || config.files.strategy === 'symlink';
  const shouldBackup = options.backup ?? config.files.backupOnRestore;

  // Prepare hook options
  const hookOptions: HookOptions = {
    skipHooks: options.noHooks,
    trustHooks: options.trustHooks,
  };

  // Run pre-restore hook
  await runPreRestoreHook(tuckDir, hookOptions);

  // Pre-restore Time Machine snapshot of host paths that already exist, so
  // `tuck undo` can roll back an unwanted restore. Skipped on dry-run and when
  // `backupOnRestore` is disabled (either via config or `--no-backup`). Only
  // captures paths that exist (no point snapshotting files that don't yet
  // exist on disk).
  if (!options.dryRun && shouldBackup) {
    const existingHostPaths: string[] = [];
    for (const file of files) {
      if (file.existsAtTarget) {
        existingHostPaths.push(expandPath(file.source));
      }
    }

    if (existingHostPaths.length > 0) {
      await withSpinner('Creating snapshot before restore...', async () => {
        await createSnapshot(
          existingHostPaths,
          `Pre-restore snapshot: ${existingHostPaths.length} file${existingHostPaths.length === 1 ? '' : 's'}`,
          { kind: 'restore' }
        );
      });
      await pruneSnapshotsFromConfig(tuckDir);
    }
  }

  let restoredCount = 0;
  const restoredPaths: string[] = [];

  for (const file of files) {
    validateSafeSourcePath(file.source);
    validatePathWithinRoot(file.destination, tuckDir, 'restore source');
    const targetPath = expandPath(file.source);

    // Check if source exists in repository
    if (!(await pathExists(file.destination))) {
      logger.warning(`Source not found in repository: ${file.source}`);
      continue;
    }

    // Dry run - just show what would happen
    if (options.dryRun) {
      if (file.existsAtTarget) {
        logger.file('modify', `${file.source} (would overwrite)`);
      } else {
        logger.file('add', `${file.source} (would create)`);
      }
      continue;
    }

    // Restore file
    await withSpinner(`Restoring ${file.source}...`, async () => {
      if (useSymlink) {
        await createSymlink(file.destination, targetPath, { overwrite: true });
      } else {
        await copyFileOrDir(file.destination, targetPath, { overwrite: true });
      }

      // Fix permissions for sensitive files
      await fixSSHPermissions(file.source);
      await fixGPGPermissions(file.source);
    });

    restoredCount++;
    restoredPaths.push(targetPath);
  }

  // Restore secrets (replace placeholders with actual values)
  let secretsRestored = 0;
  let unresolvedPlaceholders: string[] = [];

  if (!options.noSecrets && !options.dryRun && restoredPaths.length > 0) {
    const secretCount = await getSecretCount(tuckDir);
    if (secretCount > 0) {
      const secretResult = await restoreSecrets(restoredPaths, tuckDir);
      secretsRestored = secretResult.totalRestored;
      unresolvedPlaceholders = secretResult.allUnresolved;
    }
  }

  // Run post-restore hook
  await runPostRestoreHook(tuckDir, hookOptions);

  return {
    restoredCount,
    secretsRestored,
    unresolvedPlaceholders,
    restoredPaths,
  };
};

const runInteractiveRestore = async (tuckDir: string, options: RestoreOptions = {}): Promise<string[]> => {
  // Refuse to prompt when stdout isn't a TTY — `@clack/prompts.multiselect` would
  // still open a readline on /dev/pts/0 and hang forever because no UI is visible
  // to the user. Force-fail with guidance to pass --all or explicit paths.
  if (!isInteractive()) {
    throw new NonInteractivePromptError('tuck restore', [
      'Pass --all to restore every tracked file non-interactively',
      'Or pass one or more explicit paths (e.g. `tuck restore ~/.zshrc`)',
      'Combine with -g <group> to scope the restore to a host-group',
    ]);
  }

  prompts.intro('tuck restore');

  // Get all tracked files
  const filterGroups = await resolveGroupFilter(tuckDir, options);
  const files = await prepareFilesToRestore(tuckDir, undefined, filterGroups);

  if (files.length === 0) {
    prompts.log.warning('No files to restore');
    prompts.note("Run 'tuck add <path>' to track files first", 'Tip');
    return [];
  }

  // Let user select files to restore
  const fileOptions = files.map((file) => {
    const categoryConfig = CATEGORIES[file.category] || { icon: '📄' };
    const status = file.existsAtTarget ? c.yellow('(exists, will backup)') : '';

    return {
      value: file.id,
      label: `${categoryConfig.icon} ${file.source} ${status}`,
      hint: file.category,
    };
  });

  const selectedIds = await prompts.multiselect('Select files to restore:', fileOptions, {
    required: true,
  });

  if (selectedIds.length === 0) {
    prompts.cancel('No files selected');
    return [];
  }

  const selectedFiles = files.filter((f) => selectedIds.includes(f.id));

  // Check for files that exist
  const existingFiles = selectedFiles.filter((f) => f.existsAtTarget);
  if (existingFiles.length > 0) {
    console.log();
    prompts.log.warning(
      `${existingFiles.length} file${existingFiles.length > 1 ? 's' : ''} will be backed up:`
    );
    existingFiles.forEach((f) => console.log(c.dim(`  ${f.source}`)));
    console.log();
  }

  // Ask about strategy
  const useSymlink = await prompts.select('Restore method:', [
    { value: false, label: 'Copy files', hint: 'Recommended' },
    { value: true, label: 'Create symlinks', hint: 'Files stay in tuck repo' },
  ]);

  // Confirm
  const confirm = await prompts.confirm(
    `Restore ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}?`,
    true
  );

  if (!confirm) {
    prompts.cancel('Operation cancelled');
    return [];
  }

  // Restore
  const result = await restoreFilesInternal(tuckDir, selectedFiles, {
    symlink: useSymlink as boolean,
    backup: true,
    noSecrets: options.noSecrets,
  });

  console.log();

  // Display secret restoration info
  if (result.secretsRestored > 0) {
    prompts.log.success(`Restored ${result.secretsRestored} secret${result.secretsRestored !== 1 ? 's' : ''}`);
  }
  if (result.unresolvedPlaceholders.length > 0) {
    prompts.log.warning(
      `${result.unresolvedPlaceholders.length} unresolved placeholder${result.unresolvedPlaceholders.length !== 1 ? 's' : ''}:`
    );
    result.unresolvedPlaceholders.slice(0, 5).forEach((p) => console.log(c.dim(`  {{${p}}}`)));
    if (result.unresolvedPlaceholders.length > 5) {
      console.log(c.dim(`  ... and ${result.unresolvedPlaceholders.length - 5} more`));
    }
    prompts.note("Use 'tuck secrets set <NAME>' to add missing secrets", 'Tip');
  }

  prompts.outro(`Restored ${result.restoredCount} file${result.restoredCount !== 1 ? 's' : ''}`);
  return result.restoredPaths;
};

/**
 * Display secret restoration summary
 */
const displaySecretSummary = (result: RestoreResult): void => {
  if (result.secretsRestored > 0) {
    logger.success(`Restored ${result.secretsRestored} secret${result.secretsRestored !== 1 ? 's' : ''}`);
  }
  if (result.unresolvedPlaceholders.length > 0) {
    logger.warning(
      `${result.unresolvedPlaceholders.length} unresolved placeholder${result.unresolvedPlaceholders.length !== 1 ? 's' : ''}:`
    );
    result.unresolvedPlaceholders.slice(0, 5).forEach((p) => console.log(c.dim(`  {{${p}}}`)));
    if (result.unresolvedPlaceholders.length > 5) {
      console.log(c.dim(`  ... and ${result.unresolvedPlaceholders.length - 5} more`));
    }
    logger.info("Use 'tuck secrets set <NAME>' to add missing secrets");
  }
};

/**
 * On a multi-group repo, the first successful restore on a new host is the
 * right moment to ask which group(s) this machine belongs to — the manifest
 * is now on disk, so the candidate groups are discoverable. Persists the
 * selection to `.tuckrc.local.json`, which pairs with the TASK-046 sync/push
 * gate: without this, those commands would refuse on the next invocation.
 *
 * Silent no-op when the host is already assigned, the repo has ≤1 groups,
 * the run is a dry-run, or the caller isn't interactive (non-interactive
 * paths emit an advisory warning instead of prompting).
 */
const maybePromptForGroupAssignment = async (
  tuckDir: string,
  options: RestoreOptions
): Promise<void> => {
  if (options.dryRun) return;

  const config = await loadConfig(tuckDir);
  if (config?.defaultGroups && config.defaultGroups.length > 0) return;

  const allGroups = await getAllGroups(tuckDir);
  if (allGroups.length <= 1) return;

  if (!isInteractive()) {
    logger.blank();
    logger.warning('Host has no default group assigned on a multi-group repo.');
    logger.info(`Available groups: ${allGroups.join(', ')}`);
    logger.info('Sync/push will refuse until this is set. Run `tuck restore --all` interactively, or:');
    logger.info(`  tuck config set defaultGroups ${allGroups[0]}`);
    return;
  }

  logger.blank();
  prompts.log.info(
    `This host has no default group assigned, but the repo has ${allGroups.length} groups.`
  );
  logger.dim('(Space to toggle selection, Enter to confirm)');

  const preselected = (options.group ?? []).filter((g) => allGroups.includes(g));
  const selected = await prompts.multiselect<string>(
    'Which group(s) does this host belong to? (saved to .tuckrc.local.json)',
    allGroups.map((g) => ({ value: g, label: g })),
    {
      required: true,
      initialValues: preselected.length > 0 ? preselected : undefined,
    }
  );

  if (!selected || selected.length === 0) {
    logger.info(`Skipped — set later with \`tuck config set defaultGroups ${allGroups[0]}\``);
    return;
  }

  await saveLocalConfig({ defaultGroups: selected });
  logger.success(
    `Host assigned to group${selected.length > 1 ? 's' : ''}: ${selected.join(', ')}`
  );
};

const logMissingDepsList = (missing: readonly MissingDep[]): void => {
  logger.blank();
  logger.warning(
    `Detected ${missing.length} missing tool dependenc${missing.length === 1 ? 'y' : 'ies'} based on restored dotfiles:`
  );
  for (const dep of missing) {
    console.log(c.dim(`  • ${dep.id}`));
  }
};

const skippedAdvisory = (missing: readonly MissingDep[]): void => {
  const ids = missing.map((d) => d.id).join(',');
  logger.info(`Skipped — run \`tuck bootstrap --tools ${ids}\` to install.`);
};

/**
 * After restore completes, check whether any tool in the bootstrap catalog
 * (a) claims one of the restored paths via `associatedConfig` and (b)
 * isn't currently installed on this host. If so, offer to run
 * `tuck bootstrap --tools <ids>` inline. Silent no-op when nothing is
 * missing — parallel pattern to `maybePromptForGroupAssignment`.
 *
 * Decision matrix around `options.installDeps`:
 *   `true`      — run bootstrap, no prompt (also the non-TTY opt-in).
 *   `false`     — log advisory, no prompt.
 *   `undefined` — TTY: y/n confirm (default Yes). Non-TTY: advisory.
 *
 * We never silently auto-install on non-TTY without `--install-deps`:
 * a user scripting `tuck restore` on CI should opt in explicitly, not
 * have bootstrap fire as a surprise side-effect of restore.
 */
const maybePromptForMissingDeps = async (
  tuckDir: string,
  restoredPaths: readonly string[],
  options: RestoreOptions
): Promise<void> => {
  if (options.dryRun) return;
  if (restoredPaths.length === 0) return;

  const missing = await findMissingDeps(tuckDir, restoredPaths);
  if (missing.length === 0) return;

  if (options.installDeps === false) {
    logMissingDepsList(missing);
    skippedAdvisory(missing);
    return;
  }

  if (options.installDeps !== true && !isInteractive()) {
    logMissingDepsList(missing);
    skippedAdvisory(missing);
    return;
  }

  const ids = missing.map((d) => d.id);
  const toolsArg = ids.join(',');

  if (options.installDeps !== true) {
    logMissingDepsList(missing);
    const proceed = await prompts.confirm('Install them now?', true);
    if (!proceed) {
      skippedAdvisory(missing);
      return;
    }
  } else {
    logMissingDepsList(missing);
  }

  await runBootstrap({ tools: toolsArg, yes: true });
};

/**
 * Run restore programmatically (exported for use by other commands)
 */
export const runRestore = async (options: RestoreOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  // Verify tuck is initialized
  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);

  let restoredPaths: string[] = [];

  // Run interactive restore when called programmatically with --all
  if (options.all) {
    // Prepare files to restore
    const filterGroups = await resolveGroupFilter(tuckDir, options);
    const files = await prepareFilesToRestore(tuckDir, undefined, filterGroups);

    if (files.length === 0) {
      // Don't early-return: we still want to offer group assignment on a fresh
      // unassigned host where "no files" may be *caused by* the missing group.
      logger.warning('No files to restore');
    } else {
      // Restore files with progress
      const result = await restoreFilesInternal(tuckDir, files, options);
      restoredPaths = result.restoredPaths;

      logger.blank();
      displaySecretSummary(result);
      logger.success(
        `Restored ${result.restoredCount} file${result.restoredCount !== 1 ? 's' : ''}`
      );
    }
  } else {
    restoredPaths = await runInteractiveRestore(tuckDir, options);
  }

  await maybePromptForGroupAssignment(tuckDir, options);
  await maybePromptForMissingDeps(tuckDir, restoredPaths, options);
};

const runRestoreCommand = async (paths: string[], options: RestoreOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  // Verify tuck is initialized
  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);

  // If no paths and no --all, run interactive
  if (paths.length === 0 && !options.all) {
    const restoredPaths = await runInteractiveRestore(tuckDir, options);
    await maybePromptForGroupAssignment(tuckDir, options);
    await maybePromptForMissingDeps(tuckDir, restoredPaths, options);
    return;
  }

  // Prepare files to restore
  const filterGroups = await resolveGroupFilter(tuckDir, options);
  const files = await prepareFilesToRestore(
    tuckDir,
    options.all ? undefined : paths,
    filterGroups
  );

  if (files.length === 0) {
    logger.warning('No files to restore');
    await maybePromptForGroupAssignment(tuckDir, options);
    return;
  }

  // Show what will be restored
  if (options.dryRun) {
    logger.heading('Dry run - would restore:');
  } else {
    logger.heading('Restoring:');
  }

  // Restore files
  const result = await restoreFilesInternal(tuckDir, files, options);

  logger.blank();

  if (options.dryRun) {
    logger.info(`Would restore ${files.length} file${files.length > 1 ? 's' : ''}`);
  } else {
    displaySecretSummary(result);
    logger.success(`Restored ${result.restoredCount} file${result.restoredCount !== 1 ? 's' : ''}`);
    await maybePromptForGroupAssignment(tuckDir, options);
    await maybePromptForMissingDeps(tuckDir, result.restoredPaths, options);
  }
};

const collectGroup = (value: string, previous: string[] = []): string[] => [
  ...previous,
  ...value
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean),
];

export const restoreCommand = new Command('restore')
  .description('Restore dotfiles to the system')
  .argument('[paths...]', 'Paths to restore (or use --all)')
  .option('-a, --all', 'Restore all tracked files')
  .option('-g, --group <name>', 'Filter by host-group (repeatable)', collectGroup, [])
  .option('--symlink', 'Create symlinks from source paths to tuck repo files')
  .option('--backup', 'Backup existing files before restore')
  .option('--no-backup', 'Skip backup of existing files')
  .option('--dry-run', 'Show what would be done')
  .option('--no-hooks', 'Skip execution of pre/post restore hooks')
  .option('--trust-hooks', 'Trust and run hooks without confirmation (use with caution)')
  .option('--no-secrets', 'Skip restoring secrets (keep placeholders as-is)')
  .option(
    '--install-deps',
    'Auto-install any missing tool dependencies detected from restored configs (non-interactive; also the opt-in for CI / non-TTY hosts)'
  )
  .option(
    '--no-install-deps',
    'Skip the missing-deps prompt/advisory entirely'
  )
  .action(async (paths: string[], options: RestoreOptions) => {
    await runRestoreCommand(paths, options);
  });
