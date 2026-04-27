import { Command } from 'commander';
import { prompts, colors as c, formatCount } from '../ui/index.js';
import { getTuckDir, collapsePath, expandPath } from '../lib/paths.js';
import { loadManifest, getTrackedFileBySource, assertMigrated } from '../lib/manifest.js';
import { detectDotfiles, DETECTION_CATEGORIES, DetectedFile } from '../lib/detect.js';
import { NotInitializedError } from '../errors.js';
import { trackFilesWithProgress, type FileToTrack } from '../lib/fileTracking.js';
import { preparePathsForTracking } from '../lib/trackPipeline.js';
import { shouldExcludeFromBin } from '../lib/binary.js';
import { isIgnored } from '../lib/tuckignore.js';

export interface ScanOptions {
  all?: boolean;
  category?: string;
  json?: boolean;
  quick?: boolean;
}

interface SelectableFile extends DetectedFile {
  selected: boolean;
  alreadyTracked: boolean;
}

const groupSelectableByCategory = (files: SelectableFile[]): Record<string, SelectableFile[]> => {
  const grouped: Record<string, SelectableFile[]> = {};
  for (const file of files) {
    if (!grouped[file.category]) {
      grouped[file.category] = [];
    }
    grouped[file.category].push(file);
  }
  return grouped;
};

/**
 * Display detected files grouped by category. Caller assumes a frame is open.
 */
const displayGroupedFiles = (files: SelectableFile[], showAll: boolean): void => {
  const grouped = groupSelectableByCategory(files);
  const categories = Object.keys(grouped).sort((a, b) => {
    const order = Object.keys(DETECTION_CATEGORIES);
    return order.indexOf(a) - order.indexOf(b);
  });

  for (const category of categories) {
    const categoryFiles = grouped[category];
    const config = DETECTION_CATEGORIES[category] || { icon: '-', name: category };
    const newFiles = categoryFiles.filter((f) => !f.alreadyTracked);
    const trackedFiles = categoryFiles.filter((f) => f.alreadyTracked);

    const lines: string[] = [
      c.bold(`${config.icon} ${config.name}`) +
        c.dim(` (${newFiles.length} new, ${trackedFiles.length} tracked)`),
    ];

    for (const file of categoryFiles) {
      if (!showAll && file.alreadyTracked) continue;

      const status = file.selected ? c.green('[x]') : c.dim('[ ]');
      const tracked = file.alreadyTracked ? c.dim(' (tracked)') : '';
      const sensitive = file.sensitive ? c.yellow(' [!]') : '';
      const dir = file.isDirectory ? c.cyan(' [dir]') : '';

      lines.push(`  ${status} ${file.path}${dir}${sensitive}${tracked}`);
      lines.push(c.dim(`      ${file.description}`));
    }

    prompts.log.message(lines.join('\n'));
  }
};

/**
 * Interactive file selection. Caller assumes a frame is open.
 */
const runInteractiveSelection = async (files: SelectableFile[]): Promise<SelectableFile[]> => {
  const newFiles = files.filter((f) => !f.alreadyTracked);

  if (newFiles.length === 0) {
    prompts.log.success('All detected dotfiles are already being tracked!');
    return [];
  }

  const grouped = groupSelectableByCategory(newFiles);
  const selectedFiles: SelectableFile[] = [];

  for (const [category, categoryFiles] of Object.entries(grouped)) {
    const config = DETECTION_CATEGORIES[category] || { icon: '-', name: category };

    prompts.log.message(
      [c.bold(`${config.icon} ${config.name}`), c.dim(config.description || '')].join('\n'),
    );

    const options = categoryFiles.map((file: SelectableFile) => {
      let label = file.path;
      if (file.sensitive) label += c.yellow(' [!]');
      if (file.isDirectory) label += c.cyan(' [dir]');

      return {
        value: file.path,
        label,
        hint: file.description,
      };
    });

    const nonSensitiveFiles = categoryFiles.filter((f) => !f.sensitive);
    const initialValues = nonSensitiveFiles.map((f) => f.path);

    const selected = await prompts.multiselect(
      `Select files to track from ${config.name}:`,
      options,
      { initialValues },
    );

    for (const file of categoryFiles) {
      if (selected.includes(file.path)) {
        file.selected = true;
        selectedFiles.push(file);
      }
    }
  }

  return selectedFiles;
};

/**
 * Quick display mode — show what was detected, no tracking. Self-frames.
 */
const runQuickScan = async (files: SelectableFile[]): Promise<void> => {
  const newFiles = files.filter((f) => !f.alreadyTracked);
  const trackedFiles = files.filter((f) => f.alreadyTracked);

  prompts.intro('tuck scan');

  prompts.log.message(
    `${c.brandBold('Detected dotfiles:')} ${formatCount(newFiles.length, 'new file')}, ${trackedFiles.length} already tracked`,
  );

  displayGroupedFiles(files, false);

  if (newFiles.length > 0) {
    prompts.log.message(
      c.dim(
        [
          'Run `tuck scan` (without --quick) to interactively select files',
          'Or run `tuck add <path>` to add specific files',
        ].join('\n'),
      ),
    );
    prompts.outro(`${formatCount(newFiles.length, 'new dotfile')} found`);
  } else {
    prompts.outro('All detected dotfiles are already being tracked');
  }
};

/**
 * Summary display after selection. Caller assumes a frame is open.
 */
const showSummary = (selected: SelectableFile[]): void => {
  if (selected.length === 0) {
    prompts.log.info('No files selected');
    return;
  }

  const grouped = groupSelectableByCategory(selected);

  prompts.log.info(`Selected ${formatCount(selected.length, 'file')} to track:`);

  for (const [category, files] of Object.entries(grouped)) {
    const config = DETECTION_CATEGORIES[category] || { icon: '-', name: category };
    const lines: string[] = [c.bold(`${config.icon} ${config.name}`)];
    for (const file of files) {
      const sensitive = file.sensitive ? c.yellow(' ⚠') : '';
      lines.push(c.dim(`  • ${collapsePath(file.path)}${sensitive}`));
    }
    prompts.log.message(lines.join('\n'));
  }

  const sensitiveFiles = selected.filter((f) => f.sensitive);
  if (sensitiveFiles.length > 0) {
    prompts.log.warning('Some files may contain sensitive data');
    prompts.log.message(c.dim('  Make sure your repository is private!'));
  }
};

const addFilesWithProgress = async (
  selected: SelectableFile[],
  tuckDir: string,
): Promise<number> => {
  const prepared = await preparePathsForTracking(
    selected.map((file) => ({
      path: file.path,
      category: file.category,
    })),
    tuckDir,
    {
      secretHandling: 'interactive',
    },
  );

  if (prepared.length === 0) {
    return 0;
  }

  const filesToTrack: FileToTrack[] = prepared.map((file) => ({
    path: file.source,
    category: file.category,
  }));

  const result = await trackFilesWithProgress(filesToTrack, tuckDir, {
    showCategory: true,
    actionVerb: 'Tracking',
  });

  return result.succeeded;
};

export const runScan = async (options: ScanOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);

  const spinner = prompts.spinner();
  spinner.start('Scanning for dotfiles...');

  const detected = await detectDotfiles();

  spinner.stop(`Found ${detected.length} dotfiles on this system`);

  if (detected.length === 0) {
    prompts.intro('tuck scan');
    prompts.outro('No common dotfiles detected on this system');
    return;
  }

  const selectableFiles: SelectableFile[] = [];

  for (const file of detected) {
    const tracked = await getTrackedFileBySource(tuckDir, file.path);
    if (await isIgnored(tuckDir, file.path)) continue;
    if (await shouldExcludeFromBin(expandPath(file.path))) continue;

    selectableFiles.push({
      ...file,
      selected: true,
      alreadyTracked: tracked !== null,
    });
  }

  let filesToShow = selectableFiles;
  if (options.category) {
    filesToShow = selectableFiles.filter((f) => f.category === options.category);
    if (filesToShow.length === 0) {
      prompts.intro('tuck scan');
      const availableLines = Object.entries(DETECTION_CATEGORIES).map(
        ([key, config]) => `  ${config.icon} ${key} - ${config.name}`,
      );
      prompts.log.message(c.dim(['Available categories:', ...availableLines].join('\n')));
      prompts.outro(`No dotfiles found in category '${options.category}'`);
      return;
    }
  }

  if (options.json) {
    console.log(JSON.stringify(filesToShow, null, 2));
    return;
  }

  if (options.quick) {
    await runQuickScan(filesToShow);
    return;
  }

  prompts.intro('tuck scan');

  const newFiles = filesToShow.filter((f) => !f.alreadyTracked);
  const trackedCount = filesToShow.filter((f) => f.alreadyTracked).length;

  prompts.log.info(
    `Found ${filesToShow.length} dotfiles (${newFiles.length} new, ${trackedCount} tracked)`,
  );

  if (newFiles.length === 0) {
    prompts.outro('All detected dotfiles are already being tracked');
    return;
  }

  const action = await prompts.select('How would you like to proceed?', [
    {
      value: 'all',
      label: 'Track all new files',
      hint: `Add all ${newFiles.length} files`,
    },
    {
      value: 'select',
      label: 'Select files to track',
      hint: 'Choose which files to add',
    },
    {
      value: 'preview',
      label: 'Just show me what was found',
      hint: 'Display files without tracking',
    },
  ]);

  if (action === 'preview') {
    displayGroupedFiles(filesToShow, options.all || false);
    prompts.outro('Run `tuck scan` again to select files');
    return;
  }

  let selected: SelectableFile[];

  if (action === 'all') {
    selected = newFiles.map((f) => ({ ...f, selected: true }));
  } else {
    selected = await runInteractiveSelection(filesToShow);
  }

  if (selected.length === 0) {
    prompts.cancel('No files selected');
    return;
  }

  showSummary(selected);

  const confirmed = await prompts.confirm(`Track these ${selected.length} files?`, true);

  if (!confirmed) {
    prompts.cancel('Operation cancelled');
    return;
  }

  const addedCount = await addFilesWithProgress(selected, tuckDir);

  if (addedCount > 0) {
    const shouldSync = await prompts.confirm('Would you like to sync these changes now?', true);

    if (shouldSync) {
      prompts.outro(`Tracked ${formatCount(addedCount, 'file')} — syncing now`);
      const { runSync } = await import('./sync.js');
      await runSync({});
    } else {
      prompts.log.message(c.dim("Run `tuck sync` when you're ready to commit changes"));
      prompts.outro(`Tracked ${formatCount(addedCount, 'file')}`);
    }
  } else {
    prompts.outro('No files were added');
  }
};

export const scanCommand = new Command('scan')
  .description('Scan system for dotfiles and select which to track')
  .option('-a, --all', 'Show all files including already tracked ones')
  .option('-c, --category <name>', 'Filter by category (shell, git, editors, etc.)')
  .option('-q, --quick', 'Quick scan - just show detected files without interactive selection')
  .option('--json', 'Output results as JSON')
  .action(async (options: ScanOptions) => {
    await runScan(options);
  });
