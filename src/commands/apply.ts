import { Command } from 'commander';
import { join, dirname } from 'path';
import { readFile, writeFile, rm, chmod, stat } from 'fs/promises';
import { ensureDir, pathExists as fsPathExists } from 'fs-extra';
import { tmpdir } from 'os';
import { prompts, colors as c, formatCount } from '../ui/index.js';
import {
  expandPath,
  pathExists,
  collapsePath,
  validateSafeSourcePath,
  validateSafeManifestDestination,
  validatePathWithinRoot,
  getTuckDir,
} from '../lib/paths.js';
import { cloneRepo } from '../lib/git.js';
import { isGhInstalled, findDotfilesRepo, ghCloneRepo, repoExists } from '../lib/github.js';
import { createPreApplySnapshot, pruneSnapshotsFromConfig } from '../lib/timemachine.js';
import { smartMerge, isShellFile, generateMergePreview } from '../lib/merge.js';
import { CATEGORIES } from '../constants.js';
import type { TuckManifest } from '../types.js';
import { tuckManifestSchema } from '../schemas/manifest.schema.js';
import { findPlaceholders, restoreContent, restoreFiles as restoreSecrets, getAllSecrets, getSecretCount } from '../lib/secrets/index.js';
import { createResolver } from '../lib/secretBackends/index.js';
import { loadConfig } from '../lib/config.js';
import { resolveGroupFilter } from '../lib/groupFilter.js';
import { fileMatchesGroups } from '../lib/manifest.js';
import { IS_WINDOWS } from '../lib/platform.js';
import { RepositoryNotFoundError } from '../errors.js';

// Track if Windows permission warning has been shown this session
let windowsPermissionWarningShown = false;

/**
 * Fix permissions for SSH/GPG files after apply
 * On Windows, Unix-style permissions don't apply, so we log a warning instead
 */
const fixSecurePermissions = async (path: string): Promise<void> => {
  const collapsedPath = collapsePath(path);

  // Only fix permissions for SSH and GPG files
  if (!collapsedPath.includes('.ssh/') && !collapsedPath.includes('.gnupg/')) {
    return;
  }

  // On Windows, chmod is limited and Unix-style permissions don't apply
  if (IS_WINDOWS) {
    if (!windowsPermissionWarningShown) {
      prompts.log.warning(
        'Note: On Windows, file permissions cannot be restricted like on Unix systems. ' +
        'Ensure your SSH/GPG files are stored in a secure location.'
      );
      windowsPermissionWarningShown = true;
    }
    return;
  }

  try {
    const stats = await stat(path);

    if (stats.isDirectory()) {
      await chmod(path, 0o700);
    } else {
      await chmod(path, 0o600);
    }
  } catch {
    // Ignore permission errors
  }
};

export interface ApplyOptions {
  merge?: boolean;
  replace?: boolean;
  dryRun?: boolean;
  force?: boolean;
  yes?: boolean;
  /** Filter files by host-group (repeatable). */
  group?: string[];
}

interface ApplyFile {
  source: string;
  destination: string;
  category: string;
  repoPath: string;
}

interface ApplyResult {
  appliedCount: number;
  filesWithPlaceholders: Array<{
    path: string;
    placeholders: string[];
  }>;
}

/**
 * Resolve a source (username or repo URL) to a full repository identifier
 */
const resolveSource = async (source: string): Promise<{ repoId: string; isUrl: boolean }> => {
  // Check if it's a full URL
  if (source.includes('://') || source.startsWith('git@')) {
    return { repoId: source, isUrl: true };
  }

  // Check if it's a GitHub repo identifier (user/repo)
  if (source.includes('/')) {
    return { repoId: source, isUrl: false };
  }

  // Assume it's a username, try to find their dotfiles repo
  prompts.log.info(`Looking for dotfiles repository for ${source}...`);

  if (await isGhInstalled()) {
    const dotfilesRepo = await findDotfilesRepo(source);
    if (dotfilesRepo) {
      prompts.log.success(`Found repository: ${dotfilesRepo}`);
      return { repoId: dotfilesRepo, isUrl: false };
    }
  }

  // Try common repo names
  const commonNames = ['dotfiles', 'tuck', '.dotfiles'];
  for (const name of commonNames) {
    const repoId = `${source}/${name}`;
    if (await repoExists(repoId)) {
      prompts.log.success(`Found repository: ${repoId}`);
      return { repoId, isUrl: false };
    }
  }

  throw new RepositoryNotFoundError(source);
};

/**
 * Clone the source repository to a temporary directory
 */
const cloneSource = async (repoId: string, isUrl: boolean): Promise<string> => {
  const tempDir = join(tmpdir(), `tuck-apply-${Date.now()}`);
  await ensureDir(tempDir);

  if (isUrl) {
    await cloneRepo(repoId, tempDir);
  } else {
    // Use gh CLI to clone if available, otherwise construct URL
    if (await isGhInstalled()) {
      await ghCloneRepo(repoId, tempDir);
    } else {
      const url = `https://github.com/${repoId}.git`;
      await cloneRepo(url, tempDir);
    }
  }

  return tempDir;
};

/**
 * Read the manifest from a cloned repository
 */
const readClonedManifest = async (repoDir: string): Promise<TuckManifest | null> => {
  const manifestPath = join(repoDir, '.tuckmanifest.json');

  if (!(await fsPathExists(manifestPath))) {
    return null;
  }

  try {
    const content = await readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    return tuckManifestSchema.parse(parsed);
  } catch {
    return null;
  }
};

/**
 * Prepare the list of files to apply
 */
const prepareFilesToApply = async (
  repoDir: string,
  manifest: TuckManifest,
  filterGroups?: string[]
): Promise<ApplyFile[]> => {
  const files: ApplyFile[] = [];

  for (const [_id, file] of Object.entries(manifest.files)) {
    if (!fileMatchesGroups(file, filterGroups)) continue;

    try {
      validateSafeSourcePath(file.source);
      validateSafeManifestDestination(file.destination);
    } catch {
      prompts.log.warning(`Skipping unsafe manifest entry: ${file.source}`);
      continue;
    }

    const repoFilePath = join(repoDir, file.destination);

    try {
      validatePathWithinRoot(repoFilePath, repoDir, 'repository file');
    } catch {
      prompts.log.warning(`Skipping unsafe repository path from manifest: ${file.destination}`);
      continue;
    }

    if (await fsPathExists(repoFilePath)) {
      files.push({
        source: file.source,
        destination: expandPath(file.source),
        category: file.category,
        repoPath: repoFilePath,
      });
    }
  }

  return files;
};

/**
 * Resolve placeholders in file content using the configured backend
 * @returns Object with resolved content and any unresolved placeholder names
 */
const resolveFileSecrets = async (
  content: string,
  tuckDir: string
): Promise<{ content: string; unresolved: string[] }> => {
  const placeholders = findPlaceholders(content);

  if (placeholders.length === 0) {
    return { content, unresolved: [] };
  }

  try {
    const config = await loadConfig(tuckDir);
    const resolver = createResolver(tuckDir, config.security);

    // Resolve all placeholders
    // Use failOnAuthRequired to prevent interactive prompts during apply
    const secrets = await resolver.resolveToMap(placeholders, { failOnAuthRequired: true });

    // Replace placeholders with resolved values
    const result = restoreContent(content, secrets);

    return {
      content: result.restoredContent,
      unresolved: result.unresolved,
    };
  } catch (error) {
    // If resolver fails, log the error and return original content with all placeholders as unresolved
    const errorMsg = error instanceof Error ? error.message : String(error);
    prompts.log.warning(
      `Failed to resolve secrets for file content. ${placeholders.length} placeholder(s) will remain unresolved. ` +
        `Reason: ${errorMsg}`
    );
    return { content, unresolved: placeholders };
  }
};

/**
 * Apply files with merge strategy
 */
const applyWithMerge = async (files: ApplyFile[], dryRun: boolean): Promise<ApplyResult> => {
  const result: ApplyResult = {
    appliedCount: 0,
    filesWithPlaceholders: [],
  };

  // Get tuck directory for secret resolution
  const tuckDir = getTuckDir();

  for (const file of files) {
    let fileContent = await readFile(file.repoPath, 'utf-8');

    // Resolve placeholders using configured backend (1Password, Bitwarden, pass, or local)
    const secretsResult = await resolveFileSecrets(fileContent, tuckDir);
    fileContent = secretsResult.content;

    // Track only unresolved placeholders
    if (secretsResult.unresolved.length > 0) {
      result.filesWithPlaceholders.push({
        path: collapsePath(file.destination),
        placeholders: secretsResult.unresolved,
      });
    }

    if (isShellFile(file.source) && (await pathExists(file.destination))) {
      // Use smart merge for shell files
      const mergeResult = await smartMerge(file.destination, fileContent);

      if (dryRun) {
        prompts.log.info(
          `merge ${c.brand(collapsePath(file.destination))} (${mergeResult.preservedBlocks} blocks preserved)`
        );
      } else {
        await ensureDir(dirname(file.destination));
        await writeFile(file.destination, mergeResult.content, 'utf-8');
        prompts.log.info(`merge ${c.brand(collapsePath(file.destination))}`);
      }
    } else {
      // Copy non-shell files directly
      if (dryRun) {
        if (await pathExists(file.destination)) {
          prompts.log.warning(`modify ${c.brand(collapsePath(file.destination))}`);
        } else {
          prompts.log.success(`add    ${c.brand(collapsePath(file.destination))}`);
        }
      } else {
        const fileExists = await pathExists(file.destination);
        // Write file content directly instead of copying (to preserve resolved secrets)
        await ensureDir(dirname(file.destination));
        await writeFile(file.destination, fileContent, 'utf-8');
        await fixSecurePermissions(file.destination);
        if (fileExists) {
          prompts.log.warning(`modify ${c.brand(collapsePath(file.destination))}`);
        } else {
          prompts.log.success(`add    ${c.brand(collapsePath(file.destination))}`);
        }
      }
    }

    result.appliedCount++;
  }

  return result;
};

/**
 * Apply files with replace strategy
 */
const applyWithReplace = async (files: ApplyFile[], dryRun: boolean): Promise<ApplyResult> => {
  const result: ApplyResult = {
    appliedCount: 0,
    filesWithPlaceholders: [],
  };

  // Get tuck directory for secret resolution
  const tuckDir = getTuckDir();

  for (const file of files) {
    let fileContent = await readFile(file.repoPath, 'utf-8');

    // Resolve placeholders using configured backend (1Password, Bitwarden, pass, or local)
    const secretsResult = await resolveFileSecrets(fileContent, tuckDir);
    fileContent = secretsResult.content;

    // Track only unresolved placeholders
    if (secretsResult.unresolved.length > 0) {
      result.filesWithPlaceholders.push({
        path: collapsePath(file.destination),
        placeholders: secretsResult.unresolved,
      });
    }

    if (dryRun) {
      if (await pathExists(file.destination)) {
        prompts.log.warning(`modify ${c.brand(collapsePath(file.destination))} (replace)`);
      } else {
        prompts.log.success(`add    ${c.brand(collapsePath(file.destination))}`);
      }
    } else {
      const fileExists = await pathExists(file.destination);
      // Write file content directly instead of copying (to preserve resolved secrets)
      await ensureDir(dirname(file.destination));
      await writeFile(file.destination, fileContent, 'utf-8');
      await fixSecurePermissions(file.destination);
      if (fileExists) {
        prompts.log.warning(`modify ${c.brand(collapsePath(file.destination))}`);
      } else {
        prompts.log.success(`add    ${c.brand(collapsePath(file.destination))}`);
      }
    }

    result.appliedCount++;
  }

  return result;
};

/**
 * Display warnings for files with unresolved placeholders. Caller assumes a frame is open.
 */
const displayPlaceholderWarnings = (
  filesWithPlaceholders: ApplyResult['filesWithPlaceholders']
): void => {
  if (filesWithPlaceholders.length === 0) return;

  prompts.log.warning('Some files contain unresolved placeholders:');

  for (const { path, placeholders } of filesWithPlaceholders) {
    const lines: string[] = [c.dim(`${path}:`)];

    const maxToShow = 5;
    if (placeholders.length <= maxToShow) {
      for (const placeholder of placeholders) {
        lines.push(c.yellow(`  {{${placeholder}}}`));
      }
    } else {
      const firstCount = 3;
      const lastCount = 2;
      const firstPlaceholders = placeholders.slice(0, firstCount);
      const lastPlaceholders = placeholders.slice(-lastCount);

      for (const placeholder of firstPlaceholders) {
        lines.push(c.yellow(`  {{${placeholder}}}`));
      }
      lines.push(c.dim('  ...'));
      for (const placeholder of lastPlaceholders) {
        lines.push(c.yellow(`  {{${placeholder}}}`));
      }

      const shownCount = firstPlaceholders.length + lastPlaceholders.length;
      const hiddenCount = placeholders.length - shownCount;
      if (hiddenCount > 0) {
        lines.push(c.dim(`  ... and ${hiddenCount} more not shown`));
      }
    }

    prompts.log.message(lines.join('\n'));
  }

  prompts.log.message(
    c.dim(
      [
        'These placeholders need to be replaced with actual values.',
        'Use `tuck secrets set <NAME> <value>` to configure secrets,',
        'then re-apply to populate them.',
      ].join('\n'),
    ),
  );
};

/**
 * Attempt to restore secrets from local store for files with placeholders
 * Returns info about what was restored
 */
const tryRestoreSecretsFromLocalStore = async (
  filesWithPlaceholders: ApplyResult['filesWithPlaceholders'],
  interactive: boolean
): Promise<{ restored: number; unresolved: string[] }> => {
  if (filesWithPlaceholders.length === 0) {
    return { restored: 0, unresolved: [] };
  }

  const allPlaceholders = filesWithPlaceholders.flatMap(f => f.placeholders);

  // Check if local tuck is initialized and has secrets
  let tuckDir: string;
  try {
    tuckDir = getTuckDir();
  } catch {
    // Tuck not initialized locally - can't restore secrets
    return { restored: 0, unresolved: allPlaceholders };
  }

  try {
    // Check if we have any secrets stored locally
    const secretCount = await getSecretCount(tuckDir);
    if (secretCount === 0) {
      return { restored: 0, unresolved: allPlaceholders };
    }

    // Get all stored secrets
    const secrets = await getAllSecrets(tuckDir);
    const secretNames = new Set(Object.keys(secrets));

    // Check which placeholders can be resolved
    const uniquePlaceholders = new Set(allPlaceholders);
    const resolvable = [...uniquePlaceholders].filter(p => secretNames.has(p));

    if (resolvable.length === 0) {
      return { restored: 0, unresolved: [...uniquePlaceholders] };
    }

    // In interactive mode, ask if user wants to restore
    if (interactive) {
      prompts.log.info(
        `Found ${formatCount(resolvable.length, 'placeholder')} that can be restored from local secrets store.`,
      );

      const shouldRestore = await prompts.confirm(
        'Would you like to restore secrets from your local store?',
        true
      );

      if (!shouldRestore) {
        return { restored: 0, unresolved: [...uniquePlaceholders] };
      }
    }

    // Restore secrets in the applied files
    const pathsToRestore = filesWithPlaceholders.map(f => expandPath(f.path));
    const result = await restoreSecrets(pathsToRestore, tuckDir);

    if (interactive && result.totalRestored > 0) {
      prompts.log.success(`Restored ${formatCount(result.totalRestored, 'secret')} from local store`);
    }

    return {
      restored: result.totalRestored,
      unresolved: result.allUnresolved,
    };
  } catch {
    // Secret restoration failed - log warning but don't fail the apply
    prompts.log.warning('Failed to restore secrets from local store');
    return { restored: 0, unresolved: allPlaceholders };
  }
};

/**
 * Run interactive apply flow
 */
const runInteractiveApply = async (source: string, options: ApplyOptions): Promise<void> => {
  prompts.intro('tuck apply');

  // Resolve the source
  let repoId: string;
  let isUrl: boolean;

  try {
    const resolved = await resolveSource(source);
    repoId = resolved.repoId;
    isUrl = resolved.isUrl;
  } catch (error) {
    prompts.log.error(error instanceof Error ? error.message : String(error));
    prompts.outro('Apply aborted');
    return;
  }

  // Clone the repository
  let repoDir: string;
  try {
    const spinner = prompts.spinner();
    spinner.start('Cloning repository...');
    repoDir = await cloneSource(repoId, isUrl);
    spinner.stop('Repository cloned');
  } catch (error) {
    prompts.log.error(`Failed to clone: ${error instanceof Error ? error.message : String(error)}`);
    prompts.outro('Apply aborted');
    return;
  }

  try {
    // Read the manifest
    const manifest = await readClonedManifest(repoDir);

    if (!manifest) {
      prompts.log.error('No tuck manifest found in repository');
      prompts.log.message(
        c.dim('This repository may not be managed by tuck.\nLook for a .tuckmanifest.json file.'),
      );
      prompts.outro('Apply aborted');
      return;
    }

    // Prepare files to apply. Group filter resolves against the local host's
    // config (`.tuckrc.local.json` → `defaultGroups`), not the applied repo's
    // manifest — so a kali host applying a shared dotfiles repo only pulls in
    // kali-tagged files by default.
    const filterGroups = await resolveGroupFilter(getTuckDir(), options);
    const files = await prepareFilesToApply(repoDir, manifest, filterGroups);

    if (files.length === 0) {
      prompts.outro('No files to apply');
      return;
    }

    // Show what will be applied
    prompts.log.info(`Found ${formatCount(files.length, 'file')} to apply:`);

    // Group by category — emit one prompts.log.message block per category
    const byCategory: Record<string, ApplyFile[]> = {};
    for (const file of files) {
      if (!byCategory[file.category]) {
        byCategory[file.category] = [];
      }
      byCategory[file.category].push(file);
    }

    for (const [category, categoryFiles] of Object.entries(byCategory)) {
      const categoryConfig = CATEGORIES[category] || { icon: '📄' };
      const lines: string[] = [c.bold(`${categoryConfig.icon} ${category}`)];
      for (const file of categoryFiles) {
        const exists = await pathExists(file.destination);
        const status = exists ? c.yellow('(will update)') : c.green('(new)');
        lines.push(c.dim(`  ${collapsePath(file.destination)} ${status}`));
      }
      prompts.log.message(lines.join('\n'));
    }

    // Ask for merge strategy
    let strategy: 'merge' | 'replace';

    if (options.merge) {
      strategy = 'merge';
    } else if (options.replace) {
      strategy = 'replace';
    } else {
      strategy = await prompts.select('How should conflicts be handled?', [
        {
          value: 'merge',
          label: 'Merge (recommended)',
          hint: 'Preserve local customizations marked with # local or # tuck:preserve',
        },
        {
          value: 'replace',
          label: 'Replace',
          hint: 'Overwrite all files completely',
        },
      ]);
    }

    // Show merge preview for shell files if using merge strategy
    if (strategy === 'merge') {
      const shellFiles = files.filter((f) => isShellFile(f.source));
      if (shellFiles.length > 0) {
        for (const file of shellFiles.slice(0, 3)) {
          if (await pathExists(file.destination)) {
            const fileContent = await readFile(file.repoPath, 'utf-8');
            const preview = await generateMergePreview(file.destination, fileContent);
            prompts.note(preview, collapsePath(file.destination));
          }
        }
        if (shellFiles.length > 3) {
          prompts.log.info(`... and ${shellFiles.length - 3} more shell files`);
        }
      }
    }

    // Confirm
    if (!options.yes && !options.force) {
      const confirmed = await prompts.confirm(
        `Apply ${formatCount(files.length, 'file')} using ${strategy} strategy?`,
        true
      );

      if (!confirmed) {
        prompts.cancel('Apply cancelled');
        return;
      }
    }

    // Create Time Machine backup before applying
    // Note: We need to properly await async checks - Array.filter doesn't await promises
    const existingPaths = [];
    for (const file of files) {
      if (await pathExists(file.destination)) {
        existingPaths.push(file.destination);
      }
    }

    if (existingPaths.length > 0 && !options.dryRun) {
      const spinner = prompts.spinner();
      spinner.start('Creating backup snapshot...');
      const snapshot = await createPreApplySnapshot(existingPaths, repoId);
      spinner.stop(`Backup created: ${snapshot.id}`);
      try {
        await pruneSnapshotsFromConfig(getTuckDir());
      } catch {
        // Apply can be run without a local tuck init; skip prune silently.
      }
    }

    // Apply files
    if (options.dryRun) {
      prompts.log.info('Dry run — no changes will be made:');
    } else {
      prompts.log.info('Applying files...');
    }

    let applyResult: ApplyResult;
    if (strategy === 'merge') {
      applyResult = await applyWithMerge(files, options.dryRun || false);
    } else {
      applyResult = await applyWithReplace(files, options.dryRun || false);
    }

    // Show placeholder warnings
    displayPlaceholderWarnings(applyResult.filesWithPlaceholders);

    // Try to restore secrets from local store (only in non-dry-run mode)
    if (!options.dryRun && applyResult.filesWithPlaceholders.length > 0) {
      await tryRestoreSecretsFromLocalStore(applyResult.filesWithPlaceholders, true);
    }

    if (!options.dryRun) {
      prompts.log.message(
        c.dim('To undo: tuck restore --latest   ·   List backups: tuck restore --list'),
      );
    }

    prompts.outro(
      options.dryRun
        ? `Would apply ${formatCount(applyResult.appliedCount, 'file')}`
        : `Applied ${formatCount(applyResult.appliedCount, 'file')}`,
    );
  } finally {
    // Clean up temp directory
    try {
      await rm(repoDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
};

/**
 * Run non-interactive apply
 */
export const runApply = async (source: string, options: ApplyOptions): Promise<void> => {
  prompts.intro('tuck apply');

  // Resolve the source
  const { repoId, isUrl } = await resolveSource(source);

  // Clone the repository
  const spinner = prompts.spinner();
  spinner.start('Cloning repository...');
  const repoDir = await cloneSource(repoId, isUrl);
  spinner.stop('Repository cloned');

  try {
    // Read the manifest
    const manifest = await readClonedManifest(repoDir);

    if (!manifest) {
      throw new Error('No tuck manifest found in repository');
    }

    // Prepare files to apply. Group filter resolves against the local host's
    // config (`.tuckrc.local.json` → `defaultGroups`), not the applied repo's
    // manifest — so a kali host applying a shared dotfiles repo only pulls in
    // kali-tagged files by default.
    const filterGroups = await resolveGroupFilter(getTuckDir(), options);
    const files = await prepareFilesToApply(repoDir, manifest, filterGroups);

    if (files.length === 0) {
      prompts.outro('No files to apply');
      return;
    }

    // Determine strategy
    const strategy = options.replace ? 'replace' : 'merge';

    // Create backup if not dry run
    if (!options.dryRun) {
      const existingPaths = [];
      for (const file of files) {
        if (await pathExists(file.destination)) {
          existingPaths.push(file.destination);
        }
      }

      if (existingPaths.length > 0) {
        const snapSpinner = prompts.spinner();
        snapSpinner.start('Creating backup snapshot...');
        const snapshot = await createPreApplySnapshot(existingPaths, repoId);
        snapSpinner.stop(`Backup created: ${snapshot.id}`);
        try {
          await pruneSnapshotsFromConfig(getTuckDir());
        } catch {
          // Apply can run without a local tuck init; skip prune silently.
        }
      }
    }

    prompts.log.info(options.dryRun ? 'Dry run — would apply:' : 'Applying files...');

    let applyResult: ApplyResult;
    if (strategy === 'merge') {
      applyResult = await applyWithMerge(files, options.dryRun || false);
    } else {
      applyResult = await applyWithReplace(files, options.dryRun || false);
    }

    // Show placeholder warnings
    displayPlaceholderWarnings(applyResult.filesWithPlaceholders);

    // Try to restore secrets from local store (automatically in non-interactive mode)
    if (!options.dryRun && applyResult.filesWithPlaceholders.length > 0) {
      const secretResult = await tryRestoreSecretsFromLocalStore(applyResult.filesWithPlaceholders, false);
      if (secretResult.restored > 0) {
        prompts.log.success(`Restored ${formatCount(secretResult.restored, 'secret')} from local store`);
      }
      if (secretResult.unresolved.length > 0) {
        prompts.log.warning(
          `${formatCount(secretResult.unresolved.length, 'placeholder')} ${secretResult.unresolved.length === 1 ? 'remains' : 'remain'} unresolved`,
        );
      }
    }

    if (!options.dryRun) {
      prompts.log.message(c.dim('To undo: tuck restore --latest'));
    }

    prompts.outro(
      options.dryRun
        ? `Would apply ${formatCount(applyResult.appliedCount, 'file')}`
        : `Applied ${formatCount(applyResult.appliedCount, 'file')}`,
    );
  } finally {
    // Clean up temp directory
    try {
      await rm(repoDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
};

const collectApplyGroup = (value: string, previous: string[] = []): string[] => [
  ...previous,
  ...value
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean),
];

export const applyCommand = new Command('apply')
  .description('Apply dotfiles from a repository to this machine')
  .argument('<source>', 'GitHub username, user/repo, or full repository URL')
  .option('-m, --merge', 'Merge with existing files (preserve local customizations)')
  .option('-r, --replace', 'Replace existing files completely')
  .option('-g, --group <name>', 'Filter files by host-group (repeatable)', collectApplyGroup, [])
  .option('--dry-run', 'Show what would be applied without making changes')
  .option('-f, --force', 'Apply without confirmation prompts')
  .option('-y, --yes', 'Assume yes to all prompts')
  .action(async (source: string, options: ApplyOptions) => {
    // Determine if we should run interactive mode
    const isInteractive = !options.force && !options.yes && process.stdout.isTTY;

    if (isInteractive) {
      await runInteractiveApply(source, options);
    } else {
      await runApply(source, options);
    }
  });
