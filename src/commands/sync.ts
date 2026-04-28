import { Command } from 'commander';
import { join, basename } from 'path';
import { realpath } from 'fs/promises';
import { prompts, withSpinner, colors as c, formatCount } from '../ui/index.js';
import {
  getTuckDir,
  expandPath,
  pathExists,
  collapsePath,
  isDirectory,
  validateSafeSourcePath,
  validateSafeManifestDestination,
  validatePathWithinRoot,
} from '../lib/paths.js';
import {
  loadManifest,
  getAllTrackedFiles,
  updateFileInManifest,
  removeFileFromManifest,
  getTrackedFileBySource,
  assertMigrated,
  fileMatchesGroups,
} from '../lib/manifest.js';
import { resolveGroupFilter, assertHostGroupAssigned, assertHostNotReadOnly } from '../lib/groupFilter.js';
import { stageAll, commit, getStatus, push, hasRemote, fetch, pull } from '../lib/git.js';
import {
  copyFileOrDir,
  getFileChecksum,
  deleteFileOrDir,
  checkFileSizeThreshold,
  formatFileSize,
  SIZE_BLOCK_THRESHOLD,
} from '../lib/files.js';
import { addToTuckignore, loadTuckignore, isIgnored } from '../lib/tuckignore.js';
import { createSnapshot, pruneSnapshotsFromConfig } from '../lib/timemachine.js';
import { runPreSyncHook, runPostSyncHook, type HookOptions } from '../lib/hooks.js';
import { loadConfig } from '../lib/config.js';
import { validateTrackedFilesForGate } from '../lib/validators/sweep.js';
import { NotInitializedError, SecretsDetectedError } from '../errors.js';
import type { SyncOptions, FileChange } from '../types.js';
import { detectDotfiles, DETECTION_CATEGORIES, type DetectedFile } from '../lib/detect.js';
import { trackFilesWithProgress, type FileToTrack } from '../lib/fileTracking.js';
import { preparePathsForTracking } from '../lib/trackPipeline.js';
import { scanForSecrets, isSecretScanningEnabled, shouldBlockOnSecrets, processSecretsForRedaction, redactFile } from '../lib/secrets/index.js';
import { displayScanResults } from './secrets.js';
import { logForceSecretBypass } from '../lib/audit.js';

interface SyncResult {
  modified: string[];
  deleted: string[];
  commitHash?: string;
  // Note: There is no 'added' array because adding new files is done via 'tuck add', not 'tuck sync'.
  // The sync command only handles changes to already-tracked files.
}

const pathsResolveToSameLocation = async (sourcePath: string, destinationPath: string): Promise<boolean> => {
  try {
    const [resolvedSource, resolvedDestination] = await Promise.all([
      realpath(sourcePath),
      realpath(destinationPath),
    ]);
    return resolvedSource === resolvedDestination;
  } catch {
    return false;
  }
};

const detectChanges = async (
  tuckDir: string,
  filterGroups?: string[]
): Promise<FileChange[]> => {
  const files = await getAllTrackedFiles(tuckDir);
  const ignoredPaths = await loadTuckignore(tuckDir);
  const changes: FileChange[] = [];

  for (const [, file] of Object.entries(files)) {
    validateSafeSourcePath(file.source);
    validateSafeManifestDestination(file.destination);

    // Host-group filter: skip files that don't belong to any requested group.
    // When filterGroups is undefined/empty, fileMatchesGroups returns true and
    // the file passes through — preserves pre-group-filter behavior.
    // Gating here also means an out-of-group file whose source is missing on
    // this host is NOT mis-flagged as 'deleted' — it's simply out of scope.
    if (!fileMatchesGroups(file, filterGroups)) {
      continue;
    }

    // Skip if in .tuckignore
    if (ignoredPaths.has(file.source)) {
      continue;
    }

    const sourcePath = expandPath(file.source);

    // Check if source still exists
    if (!(await pathExists(sourcePath))) {
      changes.push({
        path: file.source,
        status: 'deleted',
        source: file.source,
        destination: file.destination,
      });
      continue;
    }

    // Check if file has changed compared to stored checksum
    try {
      const sourceChecksum = await getFileChecksum(sourcePath);
      if (sourceChecksum !== file.checksum) {
        changes.push({
          path: file.source,
          status: 'modified',
          source: file.source,
          destination: file.destination,
        });
      }
    } catch {
      changes.push({
        path: file.source,
        status: 'modified',
        source: file.source,
        destination: file.destination,
      });
    }
  }

  return changes;
};

/**
 * Pull from remote if behind, returns info about what happened
 */
const pullIfBehind = async (
  tuckDir: string
): Promise<{ pulled: boolean; behind: number; error?: string }> => {
  const hasRemoteRepo = await hasRemote(tuckDir);
  if (!hasRemoteRepo) {
    return { pulled: false, behind: 0 };
  }

  try {
    // Fetch to get latest remote status
    await fetch(tuckDir);

    const status = await getStatus(tuckDir);

    if (status.behind === 0) {
      return { pulled: false, behind: 0 };
    }

    // Pull with rebase to keep history clean
    await pull(tuckDir, { rebase: true });

    return { pulled: true, behind: status.behind };
  } catch (error) {
    return {
      pulled: false,
      behind: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Detect new dotfiles that are not already tracked
 */
const detectNewDotfiles = async (tuckDir: string): Promise<DetectedFile[]> => {
  // Get all detected dotfiles on the system
  const detected = await detectDotfiles();

  // Filter out already-tracked files, ignored files, and excluded patterns
  const newFiles: DetectedFile[] = [];

  for (const file of detected) {
    // Skip if already tracked
    const tracked = await getTrackedFileBySource(tuckDir, file.path);
    if (tracked) continue;

    // Skip if in .tuckignore
    if (await isIgnored(tuckDir, file.path)) continue;

    newFiles.push(file);
  }

  return newFiles;
};

const generateCommitMessage = (result: SyncResult): string => {
  const totalCount = result.modified.length + result.deleted.length;
  const date = new Date().toISOString().split('T')[0];

  // Header with emoji and count
  let message = `✨ Update dotfiles\n\n`;

  // List changes
  const changes: string[] = [];

  if (result.modified.length > 0) {
    if (result.modified.length <= 5) {
      // List individual files if 5 or fewer
      changes.push('Modified:');
      result.modified.forEach((file) => {
        changes.push(`• ${file}`);
      });
    } else {
      changes.push(`Modified: ${result.modified.length} files`);
    }
  }

  if (result.deleted.length > 0) {
    if (result.deleted.length <= 5) {
      changes.push(result.modified.length > 0 ? '\nDeleted:' : 'Deleted:');
      result.deleted.forEach((file) => {
        changes.push(`• ${file}`);
      });
    } else {
      changes.push(
        `${result.modified.length > 0 ? '\n' : ''}Deleted: ${result.deleted.length} files`
      );
    }
  }

  if (changes.length > 0) {
    message += changes.join('\n') + '\n';
  }

  // Footer with branding and metadata
  message += `\n---\n`;
  message += `📦 Managed by tuck (tuck.sh) • ${date}`;

  if (totalCount > 0) {
    message += ` • ${totalCount} file${totalCount > 1 ? 's' : ''} changed`;
  }

  return message;
};

const syncFiles = async (
  tuckDir: string,
  changes: FileChange[],
  options: SyncOptions
): Promise<SyncResult> => {
  const result: SyncResult = {
    modified: [],
    deleted: [],
  };

  // Prepare hook options for the post-sync hook below. The pre-sync hook
  // runs upstream of syncFiles (in runInteractiveSync / runSyncCommand)
  // so it fires before change detection and can *produce* tracked files
  // that the same sync then commits.
  const hookOptions: HookOptions = {
    skipHooks: options.noHooks,
    trustHooks: options.trustHooks,
  };

  // Pre-sync Time Machine snapshot of the repo-side copies that are about to
  // be overwritten. Git history already covers this, but a snapshot gives
  // `tuck undo` a consistent UI for rolling back a sync the same way a user
  // rolls back an apply or restore.
  const repoPathsToSnapshot: string[] = [];
  for (const change of changes) {
    if (change.status !== 'modified' || !change.destination) continue;
    const repoPath = join(tuckDir, change.destination);
    if (await pathExists(repoPath)) {
      repoPathsToSnapshot.push(repoPath);
    }
  }
  if (repoPathsToSnapshot.length > 0) {
    await createSnapshot(
      repoPathsToSnapshot,
      `Pre-sync snapshot: ${repoPathsToSnapshot.length} repo file${repoPathsToSnapshot.length === 1 ? '' : 's'}`,
      { kind: 'sync' }
    );
    await pruneSnapshotsFromConfig(tuckDir);
  }

  // Process each change
  for (const change of changes) {
    validateSafeSourcePath(change.source);
    if (!change.destination) {
      throw new Error(`Unsafe manifest entry detected: missing destination for ${change.source}`);
    }
    validateSafeManifestDestination(change.destination);

    const sourcePath = expandPath(change.source);
    const destPath = join(tuckDir, change.destination);
    validatePathWithinRoot(destPath, tuckDir, 'sync destination');

    if (change.status === 'modified') {
      await withSpinner(`Syncing ${change.path}...`, async () => {
        // Symlink tracking can make source and destination the same underlying file.
        // Skip copying in that case to avoid same-file copy errors.
        if (!(await pathsResolveToSameLocation(sourcePath, destPath))) {
          // For tracked directories, mirror deletions: fs-extra.copy is additive
          // (overwrites matching files but never removes stale ones). Without
          // this prune, deleting or renaming a file inside a tracked dir leaves
          // a ghost in the repo, source/dest checksums diverge permanently, and
          // every subsequent sync re-detects the dir as "modified" forever.
          // The pre-sync snapshot above covers rollback.
          if (await isDirectory(sourcePath)) {
            await deleteFileOrDir(destPath);
          }
          await copyFileOrDir(sourcePath, destPath, { overwrite: true });
        }

        // Update checksum in manifest
        const newChecksum = await getFileChecksum(destPath);
        const files = await getAllTrackedFiles(tuckDir);
        const fileId = Object.entries(files).find(([, f]) => f.source === change.source)?.[0];

        if (fileId) {
          await updateFileInManifest(tuckDir, fileId, {
            checksum: newChecksum,
            modified: new Date().toISOString(),
          });
        }
      });
      result.modified.push(basename(change.path) || change.path);
    } else if (change.status === 'deleted') {
      await withSpinner(`Removing ${change.path}...`, async () => {
        // Delete the file from the tuck repository
        await deleteFileOrDir(destPath);

        // Remove from manifest
        const files = await getAllTrackedFiles(tuckDir);
        const fileId = Object.entries(files).find(([, f]) => f.source === change.source)?.[0];

        if (fileId) {
          await removeFileFromManifest(tuckDir, fileId);
        }
      });
      result.deleted.push(basename(change.path) || change.path);
    }
  }

  // Stage and commit if not --no-commit
  if (!options.noCommit && (result.modified.length > 0 || result.deleted.length > 0)) {
    await withSpinner('Staging changes...', async () => {
      await stageAll(tuckDir);
    });

    const message = options.message || generateCommitMessage(result);

    await withSpinner('Committing...', async () => {
      result.commitHash = await commit(tuckDir, message);
    });
  }

  // Run post-sync hook
  await runPostSyncHook(tuckDir, hookOptions);

  return result;
};

/**
 * Scan modified files for secrets and handle user interaction
 * Returns true if sync should continue, false if aborted
 */
const scanAndHandleSecrets = async (
  tuckDir: string,
  changes: FileChange[],
  options: SyncOptions
): Promise<boolean> => {
  // Skip if force flag is set (but require confirmation first)
  if (options.force) {
    const confirmed = await prompts.confirmDangerous(
      'Using --force bypasses secret scanning.\n' +
        'Any secrets in modified files may be committed to git and potentially exposed.',
      'force'
    );
    if (!confirmed) {
      prompts.log.info('Sync cancelled');
      return false;
    }
    prompts.log.warning('Secret scanning bypassed with --force');
    // Audit log for security tracking
    await logForceSecretBypass('tuck sync --force', changes.length);
    return true;
  }

  // Check if scanning is enabled in config
  const scanningEnabled = await isSecretScanningEnabled(tuckDir);
  if (!scanningEnabled) {
    return true;
  }

  // Get paths of modified files (not deleted)
  const modifiedPaths = changes
    .filter((c) => c.status === 'modified')
    .map((c) => expandPath(c.source));

  if (modifiedPaths.length === 0) {
    return true;
  }

  // Scan files
  const spinner = prompts.spinner();
  spinner.start('Scanning for secrets...');
  const summary = await scanForSecrets(modifiedPaths, tuckDir);
  spinner.stop('Scan complete');

  if (summary.totalSecrets === 0) {
    return true;
  }

  // Display results
  displayScanResults(summary);

  // Prompt user for action
  const action = await prompts.select('What would you like to do?', [
    { value: 'abort', label: 'Abort sync' },
    { value: 'redact', label: 'Redact secrets (replace with placeholders)' },
    { value: 'ignore', label: 'Add files to .tuckignore and skip them' },
    { value: 'proceed', label: 'Proceed anyway (secrets will be committed)' },
  ]);

  if (action === 'abort') {
    prompts.cancel('Sync aborted - secrets detected');
    return false;
  }

  if (action === 'redact') {
    // Store secrets and replace them with placeholders in the source files
    const spinner = prompts.spinner();
    spinner.start('Redacting secrets...');

    try {
      // Process secrets: store them and get placeholder mappings
      const fileRedactionMaps = await processSecretsForRedaction(summary.results, tuckDir);

      // Redact each file
      let redactedCount = 0;
      for (const result of summary.results) {
        const placeholderMap = fileRedactionMaps.get(result.path);
        if (placeholderMap && placeholderMap.size > 0) {
          await redactFile(result.path, result.matches, placeholderMap);
          redactedCount++;
        }
      }

      spinner.stop(`Redacted secrets in ${redactedCount} file${redactedCount !== 1 ? 's' : ''}`);
      prompts.log.success('Secrets stored locally and replaced with placeholders');
      prompts.note("Use 'tuck secrets list' to see stored secrets", 'Tip');
    } catch (error) {
      spinner.stop('Redaction failed');
      prompts.log.error(error instanceof Error ? error.message : String(error));
      return false;
    }

    return true;
  }

  if (action === 'ignore') {
    // Add files with secrets to .tuckignore
    for (const result of summary.results) {
      const sourcePath = changes.find((c) => expandPath(c.source) === result.path)?.source;
      if (sourcePath) {
        await addToTuckignore(tuckDir, sourcePath);
        prompts.log.message(c.dim(`Added ${collapsePath(result.path)} to .tuckignore`));
      }
    }
    // Filter out ignored files from changes list
    // Note: This intentionally mutates the 'changes' array in place so callers see the filtered list
    const filesToRemove = new Set(summary.results.map((r) => r.path));
    changes.splice(
      0,
      changes.length,
      ...changes.filter((c) => !filesToRemove.has(expandPath(c.source)))
    );

    if (changes.length === 0) {
      prompts.log.info('No remaining changes to sync');
      return false;
    }
    return true;
  }

  // proceed - continue with warning
  prompts.log.warning('Proceeding with secrets - make sure your repo is private!');
  return true;
};

/**
 * Preview which tracked files would be synced, honoring the same group filter
 * precedence as a live sync. Read-only: no pull, no hooks, no commit, no push.
 * Intended for operators to verify scope — especially on multi-host setups
 * where a bare `tuck sync` auto-scopes via `config.defaultGroups`.
 */
const runSyncList = async (tuckDir: string, options: SyncOptions): Promise<void> => {
  const groupFilter = await resolveGroupFilter(tuckDir, options);
  const allFiles = await getAllTrackedFiles(tuckDir);
  const changes = await detectChanges(tuckDir, groupFilter);

  prompts.intro('tuck sync — preview');

  if (groupFilter) {
    prompts.log.info(
      `Scoped to host-group${groupFilter.length > 1 ? 's' : ''}: ${groupFilter.join(', ')}`
    );
  } else {
    prompts.log.info('No group filter — every tracked file is in scope');
  }

  if (changes.length === 0) {
    prompts.outro('No changes to sync');
    return;
  }

  const sourceToGroups = new Map<string, string[]>();
  for (const file of Object.values(allFiles)) {
    sourceToGroups.set(file.source, file.groups ?? []);
  }

  const lines: string[] = [
    c.bold(`${formatCount(changes.length, 'file')} would be synced:`),
  ];
  for (const change of changes) {
    const groups = sourceToGroups.get(change.source) ?? [];
    const groupTag = groups.length > 0 ? ` [${groups.join(', ')}]` : '';
    const statusLabel = change.status === 'deleted' ? ' (source missing — would untrack)' : '';
    const glyph = change.status === 'deleted' ? c.error('-') : c.warning('~');
    lines.push(`  ${glyph} ${c.brand(change.source)}${groupTag}${statusLabel}`);
  }
  prompts.log.message(lines.join('\n'));

  prompts.log.message(
    c.dim("Run without --list to execute the sync, or pass -g <group> to narrow/widen the scope."),
  );
  prompts.outro(`${formatCount(changes.length, 'file')} would be synced`);
};

// Read `validation.preSync` from merged config, run a sweep across tracked
// files, and surface failing files inline as warnings. Never throws — sync
// continues regardless. Bails silently when the opt-in isn't enabled so the
// default sync path pays no validation cost.
const runPreSyncValidation = async (tuckDir: string): Promise<void> => {
  let config;
  try {
    config = await loadConfig(tuckDir);
  } catch {
    return;
  }
  if (config.validation?.preSync !== true) return;

  const failures = await validateTrackedFilesForGate(tuckDir);
  if (failures.length === 0) return;

  prompts.log.warning(
    `Pre-sync validation: ${failures.length} file${failures.length === 1 ? '' : 's'} with errors (warn-only — sync continues)`,
  );
  const preview = failures.slice(0, 5);
  for (const f of preview) {
    const errCount = f.issues.filter((i) => i.severity === 'error').length;
    prompts.log.message(c.dim(`  ${f.file} (${errCount} error${errCount === 1 ? '' : 's'})`));
  }
  if (failures.length > preview.length) {
    prompts.log.message(
      c.dim(`  ... ${failures.length - preview.length} more — run \`tuck validate\` for the full report`),
    );
  } else {
    prompts.log.message(c.dim('Run `tuck validate` for the full report.'));
  }
};

const runInteractiveSync = async (tuckDir: string, options: SyncOptions = {}): Promise<void> => {
  prompts.intro('tuck sync');

  const groupFilter = await resolveGroupFilter(tuckDir, options);
  if (groupFilter) {
    prompts.log.info(`Scoped to host-group${groupFilter.length > 1 ? 's' : ''}: ${groupFilter.join(', ')}`);
  }

  // ========== STEP 1: Pull from remote if behind ==========
  if (options.pull !== false && (await hasRemote(tuckDir))) {
    const pullSpinner = prompts.spinner();
    pullSpinner.start('Checking remote for updates...');

    const pullResult = await pullIfBehind(tuckDir);
    if (pullResult.error) {
      pullSpinner.stop(`Could not pull: ${pullResult.error}`);
      prompts.log.warning('Continuing with local changes...');
    } else if (pullResult.pulled) {
      pullSpinner.stop(
        `Pulled ${pullResult.behind} commit${pullResult.behind > 1 ? 's' : ''} from remote`
      );
    } else {
      pullSpinner.stop('Up to date with remote');
    }
  }

  // ========== STEP 1.5: Run preSync hook ==========
  // Fires BEFORE change detection so a hook that *produces* tracked files
  // (e.g. `tuck cheatsheet --output ~/.config/tuck/cheatsheet.json`) gets
  // its output picked up by detectChanges on the same run. Until v2.24.x
  // this lived inside syncFiles, which only ran once changes were already
  // detected — bootstrap-deadlocking the regen-on-sync use case.
  await runPreSyncHook(tuckDir, {
    skipHooks: options.noHooks,
    trustHooks: options.trustHooks,
  });

  // ========== STEP 2: Detect changes to tracked files ==========
  const changeSpinner = prompts.spinner();
  changeSpinner.start('Detecting changes to tracked files...');
  const changes = await detectChanges(tuckDir, groupFilter);
  changeSpinner.stop(`Found ${changes.length} changed file${changes.length !== 1 ? 's' : ''}`);

  // ========== STEP 2.5: Scan modified files for secrets ==========
  if (changes.length > 0) {
    const shouldContinue = await scanAndHandleSecrets(tuckDir, changes, options);
    if (!shouldContinue) {
      return;
    }
  }

  // ========== STEP 2.6: Optional pre-sync validation ==========
  // Opt-in via `validation.preSync: true` in `.tuckrc.json`. Warn-only:
  // surfaces parse errors / lint findings inline but does not block the
  // sync. Users who want hard-blocking can wire `tuck validate` into a
  // `preSync` hook instead.
  if (changes.length > 0) {
    await runPreSyncValidation(tuckDir);
  }

  // ========== STEP 3: Scan for new dotfiles (if enabled) ==========
  let newFiles: DetectedFile[] = [];
  if (options.scan !== false) {
    const scanSpinner = prompts.spinner();
    scanSpinner.start('Scanning for new dotfiles...');
    newFiles = await detectNewDotfiles(tuckDir);
    scanSpinner.stop(`Found ${newFiles.length} new dotfile${newFiles.length !== 1 ? 's' : ''}`);
  }

  // ========== STEP 4: Handle case where nothing to do ==========
  if (changes.length === 0 && newFiles.length === 0) {
    const gitStatus = await getStatus(tuckDir);
    if (gitStatus.hasChanges) {
      prompts.log.info('No dotfile changes, but repository has uncommitted changes');

      const commitAnyway = await prompts.confirm('Commit repository changes?');
      if (commitAnyway) {
        const message = await prompts.text('Commit message:', {
          defaultValue: 'Update dotfiles',
        });

        await stageAll(tuckDir);
        const hash = await commit(tuckDir, message);
        prompts.log.success(`Committed: ${hash.slice(0, 7)}`);

        // Push if remote exists
        if (options.push !== false && (await hasRemote(tuckDir))) {
          await pushWithSpinner(tuckDir, options);
        }
      }
    } else {
      prompts.log.success('Everything is up to date');
    }
    return;
  }

  // ========== STEP 5: Show changes to tracked files ==========
  if (changes.length > 0) {
    const changeLines: string[] = [c.bold('Changes to tracked files:')];
    for (const change of changes) {
      if (change.status === 'modified') {
        changeLines.push(c.yellow(`  ~ ${change.path}`));
      } else if (change.status === 'deleted') {
        changeLines.push(c.red(`  - ${change.path}`));
      }
    }
    prompts.log.message(changeLines.join('\n'));
  }

  // ========== STEP 6: Interactive selection for new files ==========
  let filesToTrackCandidates: Array<{ path: string; category?: string }> = [];
  let filesToTrack: FileToTrack[] = [];

  if (newFiles.length > 0) {
    // Group by category for display
    const grouped: Record<string, DetectedFile[]> = {};
    for (const file of newFiles) {
      if (!grouped[file.category]) grouped[file.category] = [];
      grouped[file.category].push(file);
    }

    const newFileLines: string[] = [c.bold(`New dotfiles found (${newFiles.length}):`)];
    for (const [category, files] of Object.entries(grouped)) {
      const categoryInfo = DETECTION_CATEGORIES[category] || { icon: '-', name: category };
      newFileLines.push(
        c.cyan(
          `  ${categoryInfo.icon} ${categoryInfo.name}: ${files.length} file${files.length > 1 ? 's' : ''}`
        )
      );
    }
    prompts.log.message(newFileLines.join('\n'));

    const trackNewFiles = await prompts.confirm(
      'Would you like to track some of these new files?',
      true
    );

    if (trackNewFiles) {
      // Create multiselect options (pre-select non-sensitive files)
      const selectOptions = newFiles.map((f) => ({
        value: f.path,
        label: `${collapsePath(expandPath(f.path))}${f.sensitive ? c.yellow(' [sensitive]') : ''}`,
        hint: f.category,
      }));

      const nonSensitiveFiles = newFiles.filter((f) => !f.sensitive);
      const initialValues = nonSensitiveFiles.map((f) => f.path);

      const selected = await prompts.multiselect('Select files to track:', selectOptions, {
        initialValues,
      });

      filesToTrackCandidates = (selected as string[]).map((path) => {
        const matched = newFiles.find((file) => file.path === path);
        return {
          path,
          category: matched?.category,
        };
      });
    }
  }

  // ========== STEP 7: Handle large files in tracked changes ==========
  const largeFiles: Array<{ path: string; size: string; sizeBytes: number }> = [];

  for (const change of changes) {
    if (change.status !== 'deleted') {
      const expandedPath = expandPath(change.source);
      const sizeCheck = await checkFileSizeThreshold(expandedPath);

      if (sizeCheck.warn || sizeCheck.block) {
        largeFiles.push({
          path: change.path,
          size: formatFileSize(sizeCheck.size),
          sizeBytes: sizeCheck.size,
        });
      }
    }
  }

  if (largeFiles.length > 0) {
    const largeFileLines: string[] = [c.yellow('Large files detected:')];
    for (const file of largeFiles) {
      largeFileLines.push(c.yellow(`  ${file.path} (${file.size})`));
    }
    largeFileLines.push(c.dim('GitHub has a 50MB warning and 100MB hard limit.'));
    prompts.log.warning(largeFileLines.join('\n'));

    const hasBlockers = largeFiles.some((f) => f.sizeBytes >= SIZE_BLOCK_THRESHOLD);

    if (hasBlockers) {
      const action = await prompts.select('Some files exceed 100MB. What would you like to do?', [
        { value: 'ignore', label: 'Add large files to .tuckignore' },
        { value: 'continue', label: 'Try to commit anyway (may fail)' },
        { value: 'cancel', label: 'Cancel sync' },
      ]);

      if (action === 'ignore') {
        for (const file of largeFiles) {
          const fullPath = changes.find((c) => c.path === file.path)?.source;
          if (fullPath) {
            await addToTuckignore(tuckDir, fullPath);
            const index = changes.findIndex((c) => c.path === file.path);
            if (index > -1) changes.splice(index, 1);
          }
        }
        prompts.log.success('Added large files to .tuckignore');

        if (changes.length === 0 && filesToTrackCandidates.length === 0) {
          prompts.log.info('No changes remaining to sync');
          return;
        }
      } else if (action === 'cancel') {
        prompts.cancel('Operation cancelled');
        return;
      }
    } else {
      const action = await prompts.select('Large files detected. What would you like to do?', [
        { value: 'continue', label: 'Continue with sync' },
        { value: 'ignore', label: 'Add to .tuckignore and skip' },
        { value: 'cancel', label: 'Cancel sync' },
      ]);

      if (action === 'ignore') {
        for (const file of largeFiles) {
          const fullPath = changes.find((c) => c.path === file.path)?.source;
          if (fullPath) {
            await addToTuckignore(tuckDir, fullPath);
            const index = changes.findIndex((c) => c.path === file.path);
            if (index > -1) changes.splice(index, 1);
          }
        }
        prompts.log.success('Added large files to .tuckignore');

        if (changes.length === 0 && filesToTrackCandidates.length === 0) {
          prompts.log.info('No changes remaining to sync');
          return;
        }
      } else if (action === 'cancel') {
        prompts.cancel('Operation cancelled');
        return;
      }
    }
  }

  // ========== STEP 8: Track new files ==========
  if (filesToTrackCandidates.length > 0) {
    const prepared = await preparePathsForTracking(filesToTrackCandidates, tuckDir, {
      secretHandling: 'interactive',
    });
    filesToTrack = prepared.map((file) => ({
      path: file.source,
      category: file.category,
    }));
  }

  if (changes.length === 0 && filesToTrack.length === 0 && filesToTrackCandidates.length > 0) {
    prompts.log.info('No changes remaining to sync');
    return;
  }

  if (filesToTrack.length > 0) {
    await trackFilesWithProgress(filesToTrack, tuckDir, {
      showCategory: true,
      actionVerb: 'Tracking',
    });
  }

  // ========== STEP 9: Sync changes to tracked files ==========
  let result: SyncResult = { modified: [], deleted: [] };

  if (changes.length > 0) {
    // Generate commit message
    const message =
      options.message ||
      generateCommitMessage({
        modified: changes.filter((c) => c.status === 'modified').map((c) => c.path),
        deleted: changes.filter((c) => c.status === 'deleted').map((c) => c.path),
      });

    prompts.log.message(
      [
        c.dim('Commit message:'),
        c.cyan(
          message
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n'),
        ),
      ].join('\n'),
    );

    result = await syncFiles(tuckDir, changes, { ...options, message });
  } else if (filesToTrack.length > 0) {
    // Only new files were added, commit them
    if (!options.noCommit) {
      const message =
        options.message ||
        `Add ${filesToTrack.length} new dotfile${filesToTrack.length > 1 ? 's' : ''}`;
      await stageAll(tuckDir);
      result.commitHash = await commit(tuckDir, message);
    }
  }

  // ========== STEP 10: Push to remote ==========
  let pushFailed = false;

  if (result.commitHash) {
    prompts.log.success(`Committed: ${result.commitHash.slice(0, 7)}`);

    if (options.push !== false && (await hasRemote(tuckDir))) {
      pushFailed = !(await pushWithSpinner(tuckDir, options));
    } else if (options.push === false) {
      prompts.log.info("Run 'tuck push' when ready to upload");
    }
  }

  // Only show success if no push failure occurred
  if (!pushFailed) {
    prompts.outro('Synced successfully!');
  }
};

/**
 * Helper to push with spinner and error handling
 */
const pushWithSpinner = async (tuckDir: string, _options: SyncOptions): Promise<boolean> => {
  const spinner = prompts.spinner();
  try {
    const status = await getStatus(tuckDir);
    const needsUpstream = !status.tracking;
    const branch = status.branch;

    spinner.start('Pushing to remote...');
    await push(tuckDir, {
      setUpstream: needsUpstream,
      branch: needsUpstream ? branch : undefined,
    });
    spinner.stop('Pushed to remote');
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    spinner.stop(`Push failed: ${errorMsg}`);
    prompts.log.warning("Run 'tuck push' to try again");
    return false;
  }
};

/**
 * Run sync programmatically (exported for use by other commands)
 */
export const runSync = async (options: SyncOptions = {}): Promise<void> => {
  const tuckDir = getTuckDir();

  // Verify tuck is initialized
  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);

  if (options.list) {
    await runSyncList(tuckDir, options);
    return;
  }

  // Block writes on consumer/unassigned hosts (readOnlyGroups guard).
  // Placed after the --list early-return so list stays read-only.
  await assertHostNotReadOnly(tuckDir, { forceWrite: options.forceWrite });

  // Always run interactive sync when called programmatically
  await runInteractiveSync(tuckDir, options);
};

export const runSyncCommand = async (
  messageArg: string | undefined,
  options: SyncOptions
): Promise<void> => {
  const tuckDir = getTuckDir();

  // Verify tuck is initialized
  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);
  await assertHostGroupAssigned(tuckDir, options);

  if (options.list) {
    await runSyncList(tuckDir, options);
    return;
  }

  // Block writes on consumer/unassigned hosts (readOnlyGroups guard).
  // Placed after the --list early-return so list stays read-only.
  await assertHostNotReadOnly(tuckDir, { forceWrite: options.forceWrite });

  // If no options (except --no-push), run interactive
  if (!messageArg && !options.message && !options.noCommit) {
    await runInteractiveSync(tuckDir, options);
    return;
  }

  prompts.intro('tuck sync');

  const groupFilter = await resolveGroupFilter(tuckDir, options);
  if (groupFilter) {
    prompts.log.info(`Scoped to host-group${groupFilter.length > 1 ? 's' : ''}: ${groupFilter.join(', ')}`);
  }

  // Run preSync hook BEFORE change detection so hook output is picked up
  // on the same run. See the matching call in runInteractiveSync for the
  // full rationale (bootstrap deadlock when a hook is meant to *produce*
  // the changes that would otherwise gate the hook from firing).
  await runPreSyncHook(tuckDir, {
    skipHooks: options.noHooks,
    trustHooks: options.trustHooks,
  });

  // Detect changes
  const changes = await detectChanges(tuckDir, groupFilter);

  if (changes.length === 0) {
    prompts.outro('No changes detected');
    return;
  }

  // Scan for secrets (non-interactive mode)
  if (!options.force) {
    const scanningEnabled = await isSecretScanningEnabled(tuckDir);
    if (scanningEnabled) {
      const modifiedPaths = changes
        .filter((c) => c.status === 'modified')
        .map((c) => expandPath(c.source));

      if (modifiedPaths.length > 0) {
        const summary = await scanForSecrets(modifiedPaths, tuckDir);
        if (summary.totalSecrets > 0) {
          displayScanResults(summary);

          // Check if we should block or just warn
          const shouldBlock = await shouldBlockOnSecrets(tuckDir);
          if (shouldBlock) {
            throw new SecretsDetectedError(
              summary.totalSecrets,
              summary.results.map((r) => collapsePath(r.path))
            );
          } else {
            // Warn but continue
            prompts.log.warning('Secrets detected but blockOnSecrets is disabled — proceeding with sync');
            prompts.log.warning('Make sure your repository is private!');
          }
        }
      }
    }
  }

  // Optional pre-sync validation (opt-in; warn-only).
  await runPreSyncValidation(tuckDir);

  // Show changes
  const changeLines: string[] = [c.bold('Changes detected:')];
  for (const change of changes) {
    const glyph = change.status === 'modified' ? c.warning('~') : c.error('-');
    changeLines.push(`  ${glyph} ${c.brand(change.path)}`);
  }
  prompts.log.message(changeLines.join('\n'));

  // Sync
  const message = messageArg || options.message;
  const result = await syncFiles(tuckDir, changes, { ...options, message });

  if (result.commitHash) {
    prompts.log.success(`Committed: ${result.commitHash.slice(0, 7)}`);

    // Push by default unless --no-push
    // Commander converts --no-push to push: false, default is push: true
    if (options.push !== false && (await hasRemote(tuckDir))) {
      await withSpinner('Pushing to remote...', async () => {
        await push(tuckDir);
      });
      prompts.outro(`Synced ${formatCount(changes.length, 'file')} — pushed`);
      return;
    } else if (options.push === false) {
      prompts.log.message(c.dim("Run `tuck push` when ready to upload"));
    }
  }

  prompts.outro(`Synced ${formatCount(changes.length, 'file')}`);
};

const collectGroup = (value: string, previous: string[] = []): string[] => [
  ...previous,
  ...value
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean),
];

export const syncCommand = new Command('sync')
  .description(
    'Sync all dotfile changes (pull, detect changes, scan for new files, track, commit, push)'
  )
  .argument('[message]', 'Commit message')
  .option('-m, --message <msg>', 'Commit message')
  // TODO: --all and --amend are planned for a future version
  // .option('-a, --all', 'Sync all tracked files, not just changed')
  // .option('--amend', 'Amend previous commit')
  .option('--no-commit', "Stage changes but don't commit")
  .option('--no-push', "Commit but don't push to remote")
  .option('--no-pull', "Don't pull from remote first")
  .option('--no-scan', "Don't scan for new dotfiles")
  .option('--no-hooks', 'Skip execution of pre/post sync hooks')
  .option('--trust-hooks', 'Trust and run hooks without confirmation (use with caution)')
  .option('-g, --group <name>', 'Filter by host-group (repeatable)', collectGroup, [])
  .option('--list', 'Preview which tracked files would be synced, then exit (no writes)')
  .option('-f, --force', 'Skip secret scanning (not recommended)')
  .option('--force-write', 'Override the readOnlyGroups consumer-host guardrail')
  .action(async (messageArg: string | undefined, options: SyncOptions) => {
    await runSyncCommand(messageArg, options);
  });
