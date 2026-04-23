import { Command } from 'commander';
import { prompts, logger } from '../ui/index.js';
import { colors as c } from '../ui/theme.js';
import {
  getTuckDir,
  expandPath,
  pathExists,
  collapsePath,
  isDirectory,
  validateSafeSourcePath,
  getSafeRepoPathFromDestination,
} from '../lib/paths.js';
import {
  loadManifest,
  getAllTrackedFiles,
  getTrackedFileBySource,
  assertMigrated,
  fileMatchesGroups,
} from '../lib/manifest.js';
import { resolveGroupFilter } from '../lib/groupFilter.js';
import { getDiff } from '../lib/git.js';
import {
  getFileChecksum,
  checkFileSizeThreshold,
  formatFileSize,
  getDirectoryFiles,
} from '../lib/files.js';
import { NotInitializedError, FileNotFoundError, PermissionError } from '../errors.js';
import { isBinaryExecutable } from '../lib/binary.js';
import { isIgnored } from '../lib/tuckignore.js';
import type { DiffOptions } from '../types.js';
import { readFile } from 'fs/promises';

interface FileDiff {
  source: string;
  destination: string;
  hasChanges: boolean;
  isBinary?: boolean;
  isDirectory?: boolean;
  fileCount?: number;
  systemSize?: number;
  repoSize?: number;
  systemContent?: string;
  repoContent?: string;
}

const isBinary = async (path: string): Promise<boolean> => {
  if (!(await pathExists(path))) {
    return false;
  }
  return await isBinaryExecutable(path);
};

const getFileDiff = async (tuckDir: string, source: string): Promise<FileDiff | null> => {
  const tracked = await getTrackedFileBySource(tuckDir, source);
  if (!tracked) {
    throw new FileNotFoundError(`Not tracked: ${source}`);
  }

  validateSafeSourcePath(tracked.file.source);
  const systemPath = expandPath(source);
  const repoPath = getSafeRepoPathFromDestination(tuckDir, tracked.file.destination);

  const diff: FileDiff = {
    source,
    destination: tracked.file.destination,
    hasChanges: false,
  };

  const systemExists = await pathExists(systemPath);
  const repoExists = await pathExists(repoPath);

  // Check if system file exists
  if (!systemExists) {
    diff.hasChanges = true;
    if (repoExists) {
      // Check if repo file is a directory
      if (await isDirectory(repoPath)) {
        diff.isDirectory = true;
        const files = await getDirectoryFiles(repoPath);
        diff.fileCount = files.length;
      } else {
        const repoContent = await readFile(repoPath, 'utf-8');
        diff.repoContent = repoContent;
        diff.repoSize = repoContent.length;
      }
    }
    return diff;
  }

  // Check if repo file exists
  if (!repoExists) {
    diff.hasChanges = true;
    // Check if system file is a directory
    if (await isDirectory(systemPath)) {
      diff.isDirectory = true;
      const files = await getDirectoryFiles(systemPath);
      diff.fileCount = files.length;
    } else {
      const systemContent = await readFile(systemPath, 'utf-8');
      diff.systemContent = systemContent;
      diff.systemSize = systemContent.length;
    }
    return diff;
  }

  // Check if directory (both exist now)
  const systemIsDir = await isDirectory(systemPath);
  const repoIsDir = await isDirectory(repoPath);

  if (systemIsDir || repoIsDir) {
    diff.isDirectory = true;

    // Get file counts for directory summary
    if (systemIsDir) {
      const files = await getDirectoryFiles(systemPath);
      diff.fileCount = files.length;
    }
    if (repoIsDir) {
      const files = await getDirectoryFiles(repoPath);
      diff.fileCount = (diff.fileCount || 0) + files.length;
    }

    // Compare checksums for directories too
    const systemChecksum = await getFileChecksum(systemPath);
    const repoChecksum = await getFileChecksum(repoPath);
    diff.hasChanges = systemChecksum !== repoChecksum;

    return diff;
  }

  // Check if binary
  const systemIsBinary = await isBinary(systemPath);
  const repoIsBinary = await isBinary(repoPath);

  if (systemIsBinary || repoIsBinary) {
    diff.isBinary = true;

    // Compare binary files using checksums
    const systemChecksum = await getFileChecksum(systemPath);
    const repoChecksum = await getFileChecksum(repoPath);
    diff.hasChanges = systemChecksum !== repoChecksum;

    try {
      const systemBuffer = await readFile(systemPath);
      diff.systemSize = systemBuffer.length;
    } catch {
      // Ignore read errors for binaries
    }
    try {
      const repoBuffer = await readFile(repoPath);
      diff.repoSize = repoBuffer.length;
    } catch {
      // Ignore read errors for binaries
    }
    return diff;
  }

  // Check file size for large files
  try {
    const systemSizeCheck = await checkFileSizeThreshold(systemPath);
    const repoSizeCheck = await checkFileSizeThreshold(repoPath);

    diff.systemSize = systemSizeCheck.size;
    diff.repoSize = repoSizeCheck.size;
  } catch {
    // Size check failed, continue with diff
  }

  // Compare checksums for text files
  const systemChecksum = await getFileChecksum(systemPath);
  const repoChecksum = await getFileChecksum(repoPath);

  if (systemChecksum !== repoChecksum) {
    diff.hasChanges = true;
    diff.systemContent = await readFile(systemPath, 'utf-8');
    diff.repoContent = await readFile(repoPath, 'utf-8');
  }

  return diff;
};

const formatUnifiedDiff = (diff: FileDiff): string => {
  const lines: string[] = [];

  lines.push(c.bold(`--- a/${diff.source} (system)`));
  lines.push(c.bold(`+++ b/${diff.source} (repository)`));

  if (diff.isBinary) {
    const sysSize = diff.systemSize ? formatFileSize(diff.systemSize) : '0 B';
    const repoSize = diff.repoSize ? formatFileSize(diff.repoSize) : '0 B';
    lines.push(c.dim('Binary files differ'));
    lines.push(c.dim(`  System:  ${sysSize}`));
    lines.push(c.dim(`  Repo:    ${repoSize}`));
    return lines.join('\n');
  }

  if (diff.isDirectory) {
    const fileCount = diff.fileCount || 0;
    lines.push(c.dim('Directory content changed'));
    lines.push(c.dim(`  Contains ${fileCount} file${fileCount > 1 ? 's' : ''}`));
    return lines.join('\n');
  }

  const { systemContent, repoContent } = diff;

  // Check if systemContent is explicitly undefined (missing) vs empty string
  const systemMissing = systemContent === undefined;
  const repoMissing = repoContent === undefined;

  if (systemMissing && !repoMissing) {
    // File only in repo
    lines.push(c.red('File missing on system'));
    lines.push(c.dim('Repository content:'));
    repoContent!.split('\n').forEach((line) => {
      lines.push(c.green(`+ ${line}`));
    });
  } else if (!systemMissing && repoMissing) {
    // File only on system
    lines.push(c.yellow('File not yet synced to repository'));
    lines.push(c.dim('System content:'));
    systemContent!.split('\n').forEach((line) => {
      lines.push(c.red(`- ${line}`));
    });
  } else if (!systemMissing && !repoMissing) {
    // Both files exist (may be empty)
    const CONTEXT_LINES = 3;
    const systemLines = systemContent!.split('\n');
    const repoLines = repoContent!.split('\n');

    const maxLines = Math.max(systemLines.length, repoLines.length);

    let inDiff = false;
    let diffStart = 0;

    for (let i = 0; i < maxLines; i++) {
      const sysLine = systemLines[i];
      const repoLine = repoLines[i];

      if (sysLine !== repoLine) {
        if (!inDiff) {
          inDiff = true;
          diffStart = i;
          const startLine = Math.max(0, diffStart - CONTEXT_LINES + 1);
          const contextLineCount = Math.min(diffStart, CONTEXT_LINES);
          const endLine = Math.min(maxLines, diffStart + CONTEXT_LINES + 1);

          lines.push(
            c.cyan(
              `@@ -${startLine + 1},${contextLineCount + 1} +${startLine + 1},${endLine - startLine} @@`
            )
          );

          // Print context lines before diff
          for (let j = startLine; j < i; j++) {
            const ctxLine = systemLines[j];
            if (ctxLine !== undefined) {
              lines.push(c.dim(`  ${ctxLine}`));
            }
          }
        }

        if (sysLine !== undefined) {
          lines.push(c.red(`- ${sysLine}`));
        }
        if (repoLine !== undefined) {
          lines.push(c.green(`+ ${repoLine}`));
        }
      } else if (inDiff) {
        // Show context lines after diff changes
        if (sysLine === repoLine && sysLine !== undefined) {
          lines.push(c.dim(`  ${sysLine}`));
        }
      } else {
        // Exit diff context after matching lines
        inDiff = false;
      }
    }
  }

  return lines.join('\n');
};

interface DiffStats {
  insertions: number;
  deletions: number;
}

const computeDiffStats = (diff: FileDiff): DiffStats => {
  if (diff.isBinary || diff.isDirectory) {
    return { insertions: 0, deletions: 0 };
  }

  const { systemContent, repoContent } = diff;
  const systemMissing = systemContent === undefined;
  const repoMissing = repoContent === undefined;

  if (systemMissing && !repoMissing) {
    return { insertions: repoContent!.split('\n').length, deletions: 0 };
  }
  if (!systemMissing && repoMissing) {
    return { insertions: 0, deletions: systemContent!.split('\n').length };
  }
  if (systemMissing && repoMissing) {
    return { insertions: 0, deletions: 0 };
  }

  // Both present — match formatUnifiedDiff's naive index-pair comparison so the
  // reported stats equal what the unified renderer actually prints.
  const systemLines = systemContent!.split('\n');
  const repoLines = repoContent!.split('\n');
  const maxLines = Math.max(systemLines.length, repoLines.length);
  let insertions = 0;
  let deletions = 0;
  for (let i = 0; i < maxLines; i++) {
    const sysLine = systemLines[i];
    const repoLine = repoLines[i];
    if (sysLine !== repoLine) {
      if (sysLine !== undefined) deletions++;
      if (repoLine !== undefined) insertions++;
    }
  }
  return { insertions, deletions };
};

const sumDiffStats = (diffs: FileDiff[]): DiffStats =>
  diffs.reduce<DiffStats>(
    (acc, d) => {
      const s = computeDiffStats(d);
      return {
        insertions: acc.insertions + s.insertions,
        deletions: acc.deletions + s.deletions,
      };
    },
    { insertions: 0, deletions: 0 }
  );

const formatSummaryLine = (files: number, stats: DiffStats): string => {
  const fileWord = files === 1 ? 'file' : 'files';
  const insWord = stats.insertions === 1 ? 'insertion' : 'insertions';
  const delWord = stats.deletions === 1 ? 'deletion' : 'deletions';
  return `${files} ${fileWord} changed, ${c.green(`${stats.insertions} ${insWord}(+)`)}, ${c.red(`${stats.deletions} ${delWord}(-)`)}`;
};

const truncatePath = (path: string, max: number): string => {
  if (path.length <= max) return path;
  if (max <= 3) return path.slice(0, max);
  return '...' + path.slice(-(max - 3));
};

const SBS_MIN_WIDTH = 80;
const SBS_CONTEXT_LINES = 3;
const TAB_EXPANSION = '    ';

const padOrTruncate = (raw: string, width: number): string => {
  // Tabs render at different widths in different terminals — normalise to 4
  // spaces so every row lines up with the gutter and no ANSI math is needed.
  const normalized = raw.replace(/\t/g, TAB_EXPANSION);
  if (normalized.length === width) return normalized;
  if (normalized.length < width) return normalized.padEnd(width);
  if (width <= 1) return normalized.slice(0, width);
  return normalized.slice(0, width - 1) + '…';
};

type SbsRow =
  | { kind: 'unchanged'; system: string; repo: string }
  | { kind: 'modified'; system: string; repo: string }
  | { kind: 'add'; repo: string }
  | { kind: 'delete'; system: string }
  | { kind: 'ruler'; skipped: number };

const buildSbsRows = (systemLines: string[], repoLines: string[]): SbsRow[] => {
  const maxLines = Math.max(systemLines.length, repoLines.length);
  const rows: SbsRow[] = [];
  for (let i = 0; i < maxLines; i++) {
    const s = systemLines[i];
    const r = repoLines[i];
    if (s === undefined && r !== undefined) rows.push({ kind: 'add', repo: r });
    else if (s !== undefined && r === undefined) rows.push({ kind: 'delete', system: s });
    else if (s !== r) rows.push({ kind: 'modified', system: s!, repo: r! });
    else rows.push({ kind: 'unchanged', system: s!, repo: r! });
  }
  return rows;
};

// Collapse runs of unchanged rows longer than 2*context to a single ruler row,
// preserving `context` lines on each side that's adjacent to a change.
const collapseUnchanged = (rows: SbsRow[], context: number): SbsRow[] => {
  const out: SbsRow[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== 'unchanged') {
      out.push(rows[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === 'unchanged') j++;
    const runLength = j - i;
    const leading = i === 0 ? 0 : context;
    const trailing = j === rows.length ? 0 : context;

    if (runLength <= leading + trailing) {
      for (let k = i; k < j; k++) out.push(rows[k]);
    } else {
      for (let k = i; k < i + leading; k++) out.push(rows[k]);
      out.push({ kind: 'ruler', skipped: runLength - leading - trailing });
      for (let k = j - trailing; k < j; k++) out.push(rows[k]);
    }
    i = j;
  }
  return out;
};

const formatSideBySide = (diff: FileDiff, termWidth: number): string => {
  // Binary, directory, and one-sided diffs don't benefit from a two-column
  // layout — the second column would be empty or meaningless. Defer to the
  // unified renderer which already handles those cases cleanly.
  if (diff.isBinary || diff.isDirectory) return formatUnifiedDiff(diff);
  const { systemContent, repoContent } = diff;
  if (systemContent === undefined || repoContent === undefined) {
    return formatUnifiedDiff(diff);
  }

  const gutter = 3;
  const col = Math.max(10, Math.floor((termWidth - gutter) / 2));
  const rowWidth = col * 2 + gutter;

  const rows = collapseUnchanged(
    buildSbsRows(systemContent.split('\n'), repoContent.split('\n')),
    SBS_CONTEXT_LINES
  );

  const lines: string[] = [];
  lines.push(
    c.bold(padOrTruncate(`--- a/${diff.source} (system)`, col)) +
      '   ' +
      c.bold(padOrTruncate(`+++ b/${diff.source} (repository)`, col))
  );
  lines.push(c.dim('─'.repeat(rowWidth)));

  for (const row of rows) {
    if (row.kind === 'ruler') {
      const label = `┄ ${row.skipped} unchanged line${row.skipped === 1 ? '' : 's'} ┄`;
      const pad = Math.max(0, Math.floor((rowWidth - label.length) / 2));
      lines.push(c.dim(' '.repeat(pad) + label));
      continue;
    }
    if (row.kind === 'unchanged') {
      lines.push(
        c.dim(padOrTruncate(row.system, col)) +
          '   ' +
          c.dim(padOrTruncate(row.repo, col))
      );
      continue;
    }
    if (row.kind === 'add') {
      lines.push(
        padOrTruncate('', col) +
          ' ' + c.green('+') + ' ' +
          c.green(padOrTruncate(row.repo, col))
      );
      continue;
    }
    if (row.kind === 'delete') {
      lines.push(
        c.red(padOrTruncate(row.system, col)) +
          ' ' + c.red('-') + ' ' +
          padOrTruncate('', col)
      );
      continue;
    }
    // modified
    lines.push(
      c.red(padOrTruncate(row.system, col)) +
        ' ' + c.yellow('|') + ' ' +
        c.green(padOrTruncate(row.repo, col))
    );
  }

  return lines.join('\n');
};

const formatStat = (diffs: FileDiff[]): string => {
  const termWidth = process.stdout.columns || 80;
  const rawMaxPath = Math.max(...diffs.map((d) => d.source.length));
  const pathWidth = Math.min(rawMaxPath, Math.max(20, Math.floor(termWidth * 0.5)));

  const perFileStats = diffs.map((d) => ({ diff: d, stats: computeDiffStats(d) }));
  const maxTotal = Math.max(
    ...perFileStats.map(({ stats }) => stats.insertions + stats.deletions)
  );
  const countWidth = Math.max(1, maxTotal.toString().length);

  // ` path | NN ` — four spaces + separator. Remaining columns go to the bar.
  const fixedOverhead = pathWidth + countWidth + 4;
  const barWidth = Math.max(10, termWidth - fixedOverhead - 2);

  const lines: string[] = [];

  for (const { diff: d, stats } of perFileStats) {
    const paddedPath = truncatePath(d.source, pathWidth).padEnd(pathWidth);

    if (d.isBinary) {
      lines.push(` ${paddedPath} | ${c.dim('Bin')}`);
      continue;
    }
    if (d.isDirectory) {
      const n = d.fileCount || 0;
      lines.push(` ${paddedPath} | ${c.dim(`Dir (${n} file${n === 1 ? '' : 's'})`)}`);
      continue;
    }

    const total = stats.insertions + stats.deletions;
    const countStr = total.toString().padStart(countWidth);

    let insBar = stats.insertions;
    let delBar = stats.deletions;
    if (total > barWidth) {
      const scale = barWidth / total;
      insBar = Math.round(stats.insertions * scale);
      delBar = Math.round(stats.deletions * scale);
      // Preserve at least one cell for any non-zero side after scaling
      if (stats.insertions > 0 && insBar === 0) insBar = 1;
      if (stats.deletions > 0 && delBar === 0) delBar = 1;
    }

    const bar = c.green('+'.repeat(insBar)) + c.red('-'.repeat(delBar));
    lines.push(` ${paddedPath} | ${countStr} ${bar}`);
  }

  lines.push('');
  lines.push(` ${formatSummaryLine(diffs.length, sumDiffStats(diffs))}`);
  return lines.join('\n');
};

const runDiff = async (paths: string[], options: DiffOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  // Verify tuck is initialized
  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);

  // If --staged, show git diff
  if (options.staged) {
    const diff = await getDiff(tuckDir, { staged: true, stat: options.stat });
    if (diff) {
      console.log(diff);
    } else {
      logger.info('No staged changes');
    }
    return;
  }

  // Get all tracked files
  const allFiles = await getAllTrackedFiles(tuckDir);
  const changedFiles: FileDiff[] = [];
  const filterGroups = await resolveGroupFilter(tuckDir, options);

  // If no paths specified, check all files
  const filesToCheck =
    paths.length === 0
      ? Object.values(allFiles)
      : paths.map((path) => {
          const expandedPath = expandPath(path);
          const collapsedPath = collapsePath(expandedPath);
          const tracked = Object.entries(allFiles).find(([, f]) => f.source === collapsedPath);
          if (!tracked) {
            throw new FileNotFoundError(`Not tracked: ${path}`);
          }
          return tracked[1];
        });

  // Check each file for changes
  for (const file of filesToCheck) {
    // Skip if host-group filter doesn't match (CLI `-g` → config.defaultGroups
    // → no filter). Explicit paths still pass through — users invoking
    // `tuck diff ~/.zshrc` want the answer for that exact file even if it's
    // tagged for a different host.
    if (paths.length === 0 && !fileMatchesGroups(file, filterGroups)) {
      continue;
    }

    // Skip if category filter is set and doesn't match
    if (options.category && file.category !== options.category) {
      continue;
    }

    // Skip if in .tuckignore
    if (await isIgnored(tuckDir, file.source)) {
      continue;
    }

    try {
      const diff = await getFileDiff(tuckDir, file.source);
      if (diff && diff.hasChanges) {
        changedFiles.push(diff);
      }
    } catch (error) {
      if (error instanceof FileNotFoundError) {
        logger.warning(`File not found: ${file.source}`);
      } else if (error instanceof PermissionError) {
        logger.warning(`Permission denied: ${file.source}`);
      } else {
        throw error;
      }
    }
  }

  if (changedFiles.length === 0) {
    if (paths.length > 0) {
      logger.success('No differences found');
    } else {
      prompts.intro('tuck diff');
      console.log();
      logger.success('No differences found');
      console.log();
    }
    return;
  }

  prompts.intro('tuck diff');
  console.log();

  // --name-only: plain path list, no stats.
  if (options.nameOnly) {
    console.log(c.bold('Changed files:'));
    console.log();
    for (const diff of changedFiles) {
      const status = diff.isDirectory ? c.dim('[dir]') : diff.isBinary ? c.dim('[bin]') : '';
      console.log(`  ${c.yellow('~')} ${diff.source} ${status}`);
    }
    console.log();
    prompts.outro(`Found ${changedFiles.length} changed file(s)`);
    return;
  }

  // --stat: git-style bar graph. Footer line carries the insertion/deletion totals.
  if (options.stat) {
    console.log(formatStat(changedFiles));
    console.log();
    prompts.outro(`Found ${changedFiles.length} changed file(s)`);
    return;
  }

  // Full-diff mode: summary header above the per-file output so long runs show
  // their scale upfront. Binary/directory diffs contribute 0/0 to the totals.
  const totals = sumDiffStats(changedFiles);
  console.log(c.bold(formatSummaryLine(changedFiles.length, totals)));
  console.log();

  // Side-by-side renders only when the terminal is wide enough — a two-column
  // layout under 80 cols truncates too aggressively to be useful. Warn the
  // user when we fall back so the flag doesn't silently no-op.
  const termWidth = process.stdout.columns || 80;
  const wantsSideBySide = options.sideBySide === true;
  const useSideBySide = wantsSideBySide && termWidth >= SBS_MIN_WIDTH;
  if (wantsSideBySide && !useSideBySide) {
    logger.warning(
      `Terminal width ${termWidth} < ${SBS_MIN_WIDTH} cols — falling back to unified diff`
    );
    console.log();
  }

  for (const diff of changedFiles) {
    console.log(
      useSideBySide ? formatSideBySide(diff, termWidth) : formatUnifiedDiff(diff)
    );
    console.log();
  }

  prompts.outro(`Found ${changedFiles.length} changed file(s)`);

  // Return exit code 1 if differences found and --exit-code is set
  if (options.exitCode) {
    process.exit(1);
  }
};

export { runDiff, formatUnifiedDiff, computeDiffStats, formatStat, formatSideBySide };

const collectGroup = (value: string, previous: string[] = []): string[] => [
  ...previous,
  ...value
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean),
];

export const diffCommand = new Command('diff')
  .description('Show differences between system and repository')
  .argument('[paths...]', 'Specific files to diff')
  .option('--staged', 'Show staged git changes')
  .option('--stat', 'Show diffstat only')
  .option(
    '--category <category>',
    'Filter by file category (shell, git, editors, terminal, ssh, misc)'
  )
  .option('-g, --group <name>', 'Filter by host-group (repeatable)', collectGroup, [])
  .option('--name-only', 'Show only changed file names')
  .option(
    '-s, --side-by-side',
    'Render diffs in two columns (auto-falls back on narrow terminals)'
  )
  .option('--exit-code', 'Return exit code 1 if differences found')
  .action(async (paths: string[], options: DiffOptions) => {
    await runDiff(paths, options);
  });
