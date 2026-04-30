import { Command } from 'commander';
import { join } from 'path';
import { colors as c } from '../ui/theme.js';
import { chmod, stat } from 'fs/promises';
import { prompts, withSpinner, isInteractive, formatCount } from '../ui/index.js';
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
import {
  findUncoveredReferences,
  type UncoveredReference,
} from '../lib/bootstrap/uncoveredReferences.js';
import { attemptBrewInstall } from '../lib/bootstrap/brewInstall.js';
import { loadBootstrapConfig } from '../lib/bootstrap/parser.js';
import { bootstrapConfigSchema } from '../schemas/bootstrap.schema.js';
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
      prompts.log.warning(`Source not found in repository: ${file.source}`);
      continue;
    }

    // Dry run - just show what would happen
    if (options.dryRun) {
      if (file.existsAtTarget) {
        prompts.log.warning(`${file.source} (would overwrite)`);
      } else {
        prompts.log.success(`${file.source} (would create)`);
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
    prompts.log.warning(`${formatCount(existingFiles.length, 'file')} will be backed up:`);
    prompts.log.message(c.dim(existingFiles.map((f) => `  ${f.source}`).join('\n')));
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

  displaySecretSummary(result);

  prompts.outro(`Restored ${formatCount(result.restoredCount, 'file')}`);
  return result.restoredPaths;
};

/**
 * Display secret restoration summary. Caller assumes a clack frame is open.
 */
const displaySecretSummary = (result: RestoreResult): void => {
  if (result.secretsRestored > 0) {
    prompts.log.success(`Restored ${formatCount(result.secretsRestored, 'secret')}`);
  }
  if (result.unresolvedPlaceholders.length > 0) {
    prompts.log.warning(
      `${formatCount(result.unresolvedPlaceholders.length, 'unresolved placeholder')}:`
    );
    const previewLines = result.unresolvedPlaceholders.slice(0, 5).map((p) => `  {{${p}}}`);
    if (result.unresolvedPlaceholders.length > 5) {
      previewLines.push(`  ... and ${result.unresolvedPlaceholders.length - 5} more`);
    }
    prompts.log.message(c.dim(previewLines.join('\n')));
    prompts.log.message(c.dim("Use `tuck secrets set <NAME>` to add missing secrets"));
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
    prompts.log.warning('Host has no default group assigned on a multi-group repo.');
    prompts.log.message(
      c.dim(
        [
          `Available groups: ${allGroups.join(', ')}`,
          'Sync/push will refuse until this is set. Run `tuck restore --all` interactively, or:',
          `  tuck config set defaultGroups ${allGroups[0]}`,
        ].join('\n')
      )
    );
    return;
  }

  prompts.log.info(
    `This host has no default group assigned, but the repo has ${formatCount(allGroups.length, 'group')}.`
  );
  prompts.log.message(c.dim('(Space to toggle selection, Enter to confirm)'));

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
    prompts.log.message(
      c.dim(`Skipped — set later with \`tuck config set defaultGroups ${allGroups[0]}\``)
    );
    return;
  }

  await saveLocalConfig({ defaultGroups: selected });
  prompts.log.success(
    `Host assigned to ${selected.length > 1 ? 'groups' : 'group'}: ${c.brand(selected.join(', '))}`
  );
};

const logMissingDepsList = (missing: readonly MissingDep[]): void => {
  prompts.log.warning(
    `Detected ${formatCount(missing.length, 'missing tool dependency', 'missing tool dependencies')} based on restored dotfiles:`
  );
  prompts.log.message(c.dim(missing.map((dep) => `  • ${dep.id}`).join('\n')));
};

const skippedAdvisory = (missing: readonly MissingDep[]): void => {
  const ids = missing.map((d) => d.id).join(',');
  prompts.log.info(`Skipped — run \`tuck bootstrap --tools ${ids}\` to install.`);
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
 * Sibling check to `maybePromptForMissingDeps`. Where missingDeps says
 * "your bootstrap.toml defines this tool, install it" — this says "your
 * dotfiles reference this tool, but bootstrap.toml has nothing covering
 * it; you should add a [[tool]] block (or pass --install-missing for a
 * one-shot brew install)."
 *
 * Default = warn-only. With `--install-missing`, brew-installs the
 * brew-installable subset and surfaces per-tool failures. Manual-install
 * tools (zimfw, neovim-plugins, zsh) always warn — they need a real
 * bootstrap.toml entry, not a one-liner.
 */
const maybeWarnAboutUncoveredReferences = async (
  tuckDir: string,
  restoredPaths: readonly string[],
  options: RestoreOptions
): Promise<void> => {
  if (options.dryRun) return;
  if (restoredPaths.length === 0) return;

  const uncovered = await findUncoveredReferences(tuckDir, restoredPaths);
  if (uncovered.length === 0) return;

  logUncoveredReferencesList(uncovered);

  if (options.installMissing !== true) {
    prompts.log.info(
      'Add `[[tool]]` blocks to bootstrap.toml to track these, or re-run with --install-missing to attempt `brew install`.'
    );
    return;
  }

  await attemptInstallMissing(uncovered);
};

const logUncoveredReferencesList = (
  uncovered: readonly UncoveredReference[]
): void => {
  prompts.log.warning(
    `Detected ${formatCount(uncovered.length, 'tool', 'tools')} referenced by restored dotfiles with no covering bootstrap.toml entry:`
  );
  prompts.log.message(
    c.dim(
      uncovered
        .map((u) => {
          const tag = u.installType === 'manual' ? ' (needs manual entry)' : '';
          return `  • ${u.id} — ${u.description}${tag}`;
        })
        .join('\n')
    )
  );
};

const attemptInstallMissing = async (
  uncovered: readonly UncoveredReference[]
): Promise<void> => {
  const brewable = uncovered.filter((u) => u.installType === 'brew');
  const manual = uncovered.filter((u) => u.installType === 'manual');

  if (manual.length > 0) {
    prompts.log.info(
      `Skipping ${formatCount(manual.length, 'tool', 'tools')} that need a manual bootstrap.toml entry: ${manual.map((m) => m.id).join(', ')}`
    );
  }

  if (brewable.length === 0) return;

  for (const tool of brewable) {
    prompts.log.step(`Installing ${tool.id} via brew (formula: ${tool.brewFormula})…`);
    const result = await attemptBrewInstall(tool.brewFormula);
    if (result.status === 'installed') {
      prompts.log.success(`Installed ${tool.id}`);
    } else if (result.status === 'skipped') {
      prompts.log.warning(
        `Skipped ${tool.id}: ${result.message ?? 'brew unavailable'}. Stopping auto-install.`
      );
      // brew unavailable means every subsequent attempt would also skip.
      // Bail with a single warning rather than N copies of the same message.
      return;
    } else {
      prompts.log.warning(
        `Failed to install ${tool.id}: ${result.message ?? 'unknown error'}. Continuing with the rest.`
      );
    }
  }
};

/**
 * `tuck restore --bootstrap -g <group>`: after restore completes, run
 * `runBootstrap({ bundle })` for each resolved group whose name matches
 * a bundle in `bootstrap.toml`. Groups without a matching bundle
 * soft-skip (e.g. a "common" shared-dotfiles group with no OS-specific
 * tools is a valid configuration). Multi-group runs execute bundles
 * sequentially; bootstrap's own state.json definition-hash mechanism
 * dedupes tools already installed by an earlier bundle in the same run.
 *
 * Silent no-op when `options.bootstrap` isn't set, on `--dry-run`, or
 * when no groups resolve. TASK-048's `maybePromptForMissingDeps` still
 * fires as today — `--bootstrap` is bundle-scoped (user-declared), while
 * missing-deps is content-scoped (derived from restored files).
 */
const maybeRunBootstrapForGroups = async (
  tuckDir: string,
  options: RestoreOptions
): Promise<void> => {
  if (!options.bootstrap) return;
  if (options.dryRun) return;

  const groups = await resolveGroupFilter(tuckDir, options);
  if (!groups || groups.length === 0) {
    prompts.log.info(
      'No group specified and no defaultGroups set; skipping bootstrap step.'
    );
    return;
  }

  const configPath = join(tuckDir, 'bootstrap.toml');
  const config = (await pathExists(configPath))
    ? await loadBootstrapConfig(configPath)
    : bootstrapConfigSchema.parse({});
  const bundleNames = new Set(Object.keys(config.bundles));

  for (const groupName of groups) {
    if (!bundleNames.has(groupName)) {
      prompts.log.info(
        `No bundle named '${groupName}', skipping bootstrap for this group.`
      );
      continue;
    }
    await runBootstrap({ bundle: groupName, yes: options.yes });
  }
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

  // Run programmatic --all restore inside its own frame
  if (options.all) {
    const filterGroups = await resolveGroupFilter(tuckDir, options);
    const files = await prepareFilesToRestore(tuckDir, undefined, filterGroups);

    prompts.intro('tuck restore');

    if (files.length === 0) {
      // Don't early-return after the outro: we still want to offer group
      // assignment on a fresh unassigned host where "no files" may be
      // *caused by* the missing group.
      prompts.outro('No files to restore');
    } else {
      const result = await restoreFilesInternal(tuckDir, files, options);
      restoredPaths = result.restoredPaths;
      displaySecretSummary(result);
      prompts.outro(`Restored ${formatCount(result.restoredCount, 'file')}`);
    }
  } else {
    restoredPaths = await runInteractiveRestore(tuckDir, options);
  }

  await maybePromptForGroupAssignment(tuckDir, options);
  await maybeRunBootstrapForGroups(tuckDir, options);
  await maybePromptForMissingDeps(tuckDir, restoredPaths, options);
  await maybeWarnAboutUncoveredReferences(tuckDir, restoredPaths, options);
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
    await maybeRunBootstrapForGroups(tuckDir, options);
    await maybePromptForMissingDeps(tuckDir, restoredPaths, options);
    await maybeWarnAboutUncoveredReferences(tuckDir, restoredPaths, options);
    return;
  }

  // Prepare files to restore
  const filterGroups = await resolveGroupFilter(tuckDir, options);
  const files = await prepareFilesToRestore(
    tuckDir,
    options.all ? undefined : paths,
    filterGroups
  );

  prompts.intro('tuck restore');

  if (files.length === 0) {
    prompts.outro('No files to restore');
    await maybePromptForGroupAssignment(tuckDir, options);
    return;
  }

  // Restore files (per-file progress emitted inside restoreFilesInternal)
  const result = await restoreFilesInternal(tuckDir, files, options);

  if (options.dryRun) {
    prompts.outro(`Would restore ${formatCount(files.length, 'file')}`);
  } else {
    displaySecretSummary(result);
    prompts.outro(`Restored ${formatCount(result.restoredCount, 'file')}`);
    await maybePromptForGroupAssignment(tuckDir, options);
    await maybeRunBootstrapForGroups(tuckDir, options);
    await maybePromptForMissingDeps(tuckDir, result.restoredPaths, options);
    await maybeWarnAboutUncoveredReferences(tuckDir, result.restoredPaths, options);
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
  .option(
    '--install-missing',
    'Attempt `brew install` for tools referenced by restored dotfiles but not declared in bootstrap.toml. Per-tool brew failures warn and continue; manual-install tools (zimfw, neovim-plugins, zsh) are never auto-installed.'
  )
  .option(
    '--bootstrap',
    'After restore, run `tuck bootstrap --bundle <g>` for each -g whose name matches a bundle (groups without a matching bundle soft-skip)'
  )
  .option('-y, --yes', 'Skip confirmations (forwarded to bootstrap when --bootstrap is set)')
  .action(async (paths: string[], options: RestoreOptions) => {
    await runRestoreCommand(paths, options);
  });
