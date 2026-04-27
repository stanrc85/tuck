import { Command } from 'commander';
import { prompts, colors as c, formatCount } from '../ui/index.js';
import { getTuckDir } from '../lib/paths.js';
import { loadManifest, assertMigrated } from '../lib/manifest.js';
import { assertHostNotReadOnly } from '../lib/groupFilter.js';
import { trackFilesWithProgress, type FileToTrack } from '../lib/fileTracking.js';
import { NotInitializedError } from '../errors.js';
import { CATEGORIES } from '../constants.js';
import type { AddOptions } from '../types.js';
import {
  preparePathsForTracking,
  type PreparedTrackFile,
  type TrackPathCandidate,
} from '../lib/trackPipeline.js';

const collectGroup = (value: string, previous: string[] = []): string[] => [
  ...previous,
  ...value
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean),
];

type FileToAdd = PreparedTrackFile;

const addFiles = async (
  filesToAdd: FileToAdd[],
  tuckDir: string,
  options: AddOptions
): Promise<void> => {
  const filesToTrack: FileToTrack[] = filesToAdd.map((f) => {
    const trackedFile: FileToTrack = {
      path: f.source,
      category: f.category,
    };

    if (f.nameOverride) {
      trackedFile.name = f.nameOverride;
    }

    if (f.groups && f.groups.length > 0) {
      trackedFile.groups = f.groups;
    }

    return trackedFile;
  });

  await trackFilesWithProgress(filesToTrack, tuckDir, {
    showCategory: true,
    strategy: options.symlink ? 'symlink' : undefined,
    actionVerb: 'Tracking',
    defaultGroups: options.group,
  });
};

const runInteractiveAdd = async (tuckDir: string, options: AddOptions): Promise<void> => {
  prompts.intro('tuck add');

  const pathsInput = await prompts.text('Enter file paths to track (space-separated):', {
    placeholder: '~/.zshrc ~/.gitconfig',
    validate: (value) => {
      if (!value.trim()) return 'At least one path is required';
      return undefined;
    },
  });

  const paths = pathsInput.split(/\s+/).filter(Boolean);
  const candidates: TrackPathCandidate[] = paths.map((path) => ({
    path,
    groups: options.group,
  }));

  let filesToAdd: FileToAdd[];
  try {
    filesToAdd = await preparePathsForTracking(candidates, tuckDir, {
      secretHandling: 'interactive',
      forceBypassCommand: 'tuck add --force',
      groups: options.group,
    });
  } catch (error) {
    if (error instanceof Error) {
      prompts.log.error(error.message);
    }
    prompts.cancel();
    return;
  }

  if (filesToAdd.length === 0) {
    prompts.outro('No files to add');
    return;
  }

  for (const file of filesToAdd) {
    prompts.log.step(`${file.source}`);

    const categoryOptions = Object.entries(CATEGORIES).map(([name, config]) => ({
      value: name,
      label: `${config.icon} ${name}`,
      hint: file.category === name ? '(auto-detected)' : undefined,
    }));

    categoryOptions.sort((a, b) => {
      if (a.value === file.category) return -1;
      if (b.value === file.category) return 1;
      return 0;
    });

    const selectedCategory = await prompts.select('Category:', categoryOptions);
    file.category = selectedCategory as string;
  }

  const confirm = await prompts.confirm(
    `Add ${filesToAdd.length} ${filesToAdd.length === 1 ? 'file' : 'files'}?`,
    true
  );

  if (!confirm) {
    prompts.cancel('Operation cancelled');
    return;
  }

  await addFiles(filesToAdd, tuckDir, {});

  prompts.log.message(c.dim("Run `tuck sync` to commit changes"));
  prompts.outro(`Added ${formatCount(filesToAdd.length, 'file')}`);
};

/**
 * Add files programmatically (used by scan/sync flows)
 * Note: Throws SecretsDetectedError when configured to block.
 */
export const addFilesFromPaths = async (
  paths: string[],
  options: AddOptions = {}
): Promise<number> => {
  const tuckDir = getTuckDir();

  try {
    await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  const candidates: TrackPathCandidate[] = paths.map((path) => ({
    path,
    category: options.category,
    name: options.name,
    groups: options.group,
  }));

  const filesToAdd = await preparePathsForTracking(candidates, tuckDir, {
    category: options.category,
    name: options.name,
    force: options.force,
    secretHandling: 'strict',
    forceBypassCommand: 'tuck add --force',
    groups: options.group,
  });

  if (filesToAdd.length === 0) {
    return 0;
  }

  await addFiles(filesToAdd, tuckDir, options);
  return filesToAdd.length;
};

const runAdd = async (paths: string[], options: AddOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);
  await assertHostNotReadOnly(tuckDir, { forceWrite: options.forceWrite });

  if (paths.length === 0) {
    await runInteractiveAdd(tuckDir, options);
    return;
  }

  prompts.intro('tuck add');

  const candidates: TrackPathCandidate[] = paths.map((path) => ({
    path,
    category: options.category,
    name: options.name,
    groups: options.group,
  }));

  let filesToAdd: FileToAdd[];
  try {
    filesToAdd = await preparePathsForTracking(candidates, tuckDir, {
      category: options.category,
      name: options.name,
      force: options.force,
      secretHandling: 'interactive',
      forceBypassCommand: 'tuck add --force',
      groups: options.group,
    });
  } catch (error) {
    if (error instanceof Error) {
      prompts.log.error(error.message);
    }
    prompts.cancel();
    return;
  }

  if (filesToAdd.length === 0) {
    prompts.outro('No files to add');
    return;
  }

  await addFiles(filesToAdd, tuckDir, options);

  const shouldSync = await prompts.confirm('Would you like to sync these changes now?', true);

  if (shouldSync) {
    prompts.outro(`Added ${formatCount(filesToAdd.length, 'file')}`);
    const { runSync } = await import('./sync.js');
    await runSync({});
  } else {
    prompts.log.message(c.dim("Run `tuck sync` when you're ready to commit changes"));
    prompts.outro(`Added ${formatCount(filesToAdd.length, 'file')}`);
  }
};

export const addCommand = new Command('add')
  .description('Track new dotfiles')
  .argument('[paths...]', 'Paths to dotfiles to track')
  .option('-c, --category <name>', 'Category to organize under')
  .option('-n, --name <name>', 'Custom name for the file in manifest')
  .option(
    '-g, --group <name>',
    'Host-group to tag (repeatable: -g kubuntu -g work)',
    collectGroup,
    []
  )
  .option('--symlink', 'Copy into tuck repo, then replace source path with a symlink')
  .option('-f, --force', 'Skip secret scanning (not recommended)')
  .option('--force-write', 'Override the readOnlyGroups consumer-host guardrail')
  .action(async (paths: string[], options: AddOptions) => {
    await runAdd(paths, options);
  });
