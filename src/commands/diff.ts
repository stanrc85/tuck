import { Command } from 'commander';
import { prompts, formatCount } from '../ui/index.js';
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
import { highlightLine } from '../lib/syntaxHighlight.js';
import type { DiffOptions } from '../types.js';
import { readFile } from 'fs/promises';
import { join, relative } from 'path';
import { toPosixPath } from '../lib/platform.js';

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

// Single-file comparison given pre-resolved absolute paths. Shared between the
// directory-expansion path (where a tracked directory's sub-files need their
// own FileDiff) and could be used to simplify getFileDiff in a future pass.
// Kept narrowly scoped: assumes neither side is a directory — caller filters
// those out — and swallows read errors on binary probes the same way
// getFileDiff does.
const buildContentDiff = async (
  source: string,
  destination: string,
  systemPath: string | null,
  repoPath: string | null,
): Promise<FileDiff | null> => {
  const systemExists = systemPath !== null && (await pathExists(systemPath));
  const repoExists = repoPath !== null && (await pathExists(repoPath));

  if (!systemExists && !repoExists) return null;

  const diff: FileDiff = { source, destination, hasChanges: false };

  if (!systemExists) {
    diff.hasChanges = true;
    // Sub-files should never be directories — expandDirectoryDiff walks files
    // only. If we see one, skip silently rather than produce a misleading diff.
    if (await isDirectory(repoPath!)) return null;
    if (await isBinary(repoPath!)) {
      diff.isBinary = true;
      try {
        diff.repoSize = (await readFile(repoPath!)).length;
      } catch {
        // Ignore read errors for binaries
      }
      return diff;
    }
    const repoContent = await readFile(repoPath!, 'utf-8');
    diff.repoContent = repoContent;
    diff.repoSize = repoContent.length;
    return diff;
  }

  if (!repoExists) {
    diff.hasChanges = true;
    if (await isDirectory(systemPath!)) return null;
    if (await isBinary(systemPath!)) {
      diff.isBinary = true;
      try {
        diff.systemSize = (await readFile(systemPath!)).length;
      } catch {
        // Ignore read errors for binaries
      }
      return diff;
    }
    const systemContent = await readFile(systemPath!, 'utf-8');
    diff.systemContent = systemContent;
    diff.systemSize = systemContent.length;
    return diff;
  }

  // Both sides present
  if ((await isDirectory(systemPath!)) || (await isDirectory(repoPath!))) {
    return null;
  }

  if ((await isBinary(systemPath!)) || (await isBinary(repoPath!))) {
    diff.isBinary = true;
    const systemChecksum = await getFileChecksum(systemPath!);
    const repoChecksum = await getFileChecksum(repoPath!);
    diff.hasChanges = systemChecksum !== repoChecksum;
    try {
      diff.systemSize = (await readFile(systemPath!)).length;
    } catch {
      // Ignore read errors for binaries
    }
    try {
      diff.repoSize = (await readFile(repoPath!)).length;
    } catch {
      // Ignore read errors for binaries
    }
    return diff;
  }

  try {
    const systemSizeCheck = await checkFileSizeThreshold(systemPath!);
    const repoSizeCheck = await checkFileSizeThreshold(repoPath!);
    diff.systemSize = systemSizeCheck.size;
    diff.repoSize = repoSizeCheck.size;
  } catch {
    // Size check failed, continue with diff
  }

  const systemChecksum = await getFileChecksum(systemPath!);
  const repoChecksum = await getFileChecksum(repoPath!);
  if (systemChecksum !== repoChecksum) {
    diff.hasChanges = true;
    diff.systemContent = await readFile(systemPath!, 'utf-8');
    diff.repoContent = await readFile(repoPath!, 'utf-8');
  }

  return diff;
};

// Expand a tracked directory into per-file FileDiff entries. Walks both the
// system and repo sides (tolerating either missing), unions the relative
// paths, and builds one FileDiff per sub-file that has changed. Returned
// diffs carry the sub-file path as `source` so every existing renderer and
// the syntax highlighter work per-file without further plumbing.
export const expandDirectoryDiff = async (
  trackedSource: string,
  trackedDestination: string,
  systemDir: string | null,
  repoDir: string | null,
): Promise<FileDiff[]> => {
  const relpaths = new Set<string>();
  if (systemDir && (await pathExists(systemDir))) {
    const files = await getDirectoryFiles(systemDir);
    for (const f of files) relpaths.add(relative(systemDir, f));
  }
  if (repoDir && (await pathExists(repoDir))) {
    const files = await getDirectoryFiles(repoDir);
    for (const f of files) relpaths.add(relative(repoDir, f));
  }

  const expandedTrackedSource = expandPath(trackedSource);
  const diffs: FileDiff[] = [];

  for (const rel of [...relpaths].sort()) {
    const subSource = collapsePath(join(expandedTrackedSource, rel));
    // Destinations are always posix-style per tuck's manifest convention
    // (forward slashes even on Windows). System/repo filesystem paths use
    // the platform-native separator via `join`.
    const subDestination = toPosixPath(join(trackedDestination, rel));
    const subSystemPath = systemDir ? join(systemDir, rel) : null;
    const subRepoPath = repoDir ? join(repoDir, rel) : null;
    const subDiff = await buildContentDiff(
      subSource,
      subDestination,
      subSystemPath,
      subRepoPath,
    );
    if (subDiff && subDiff.hasChanges) diffs.push(subDiff);
  }

  return diffs;
};

interface FileDiffsResult {
  diffs: FileDiff[];
  // Present when the tracked entry was a directory and expansion produced at
  // least one per-file sub-diff. runDiff uses this to emit a header above the
  // group so users see which directory the sub-files belong to.
  directory?: { source: string };
}

const getFileDiffs = async (
  tuckDir: string,
  source: string,
): Promise<FileDiffsResult> => {
  const single = await getFileDiff(tuckDir, source);
  if (!single) return { diffs: [] };
  if (!single.isDirectory) {
    return { diffs: single.hasChanges ? [single] : [] };
  }
  if (!single.hasChanges) return { diffs: [] };

  // Directory with changes: expand into per-file sub-diffs.
  const tracked = await getTrackedFileBySource(tuckDir, source);
  if (!tracked) return { diffs: [single] };

  const systemPath = expandPath(source);
  const repoPath = getSafeRepoPathFromDestination(tuckDir, tracked.file.destination);
  const systemExists = await pathExists(systemPath);
  const repoExists = await pathExists(repoPath);

  const sub = await expandDirectoryDiff(
    source,
    tracked.file.destination,
    systemExists ? systemPath : null,
    repoExists ? repoPath : null,
  );

  // Fall back to the directory summary if expansion yields nothing — a
  // checksum mismatch at the directory root can fire on mtime-only changes
  // (permissions, ownership) that have no file-level content delta.
  if (sub.length === 0) return { diffs: [single] };
  return { diffs: sub, directory: { source } };
};

interface DiffGroup {
  diffs: FileDiff[];
  directoryHeader?: { source: string; count: number };
}

const formatDirectoryHeader = (header: { source: string; count: number }): string => {
  const fileWord = header.count === 1 ? 'file' : 'files';
  return c.cyan(c.bold(`Directory ${header.source} — ${header.count} ${fileWord} changed`));
};

const DIFF_CONTEXT_LINES = 3;

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
// preserving `context` lines on each side adjacent to a change. Runs that
// lead/trail the file only keep context on the side facing a change.
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
  const systemMissing = systemContent === undefined;
  const repoMissing = repoContent === undefined;

  // `hl` runs syntax highlighting per line if the source path maps to a known
  // language; otherwise it's a pass-through. Wrapping the highlighted string
  // in a diff color lets chalk compose — named ANSI tokens inside respect the
  // user's terminal theme, and chalk re-applies the outer color across any
  // nested resets so the `+`/`-` tint stays consistent across the row.
  const hl = (line: string): string => highlightLine(line, diff.source);

  if (systemMissing && !repoMissing) {
    lines.push(c.red('File missing on system'));
    lines.push(c.dim('Repository content:'));
    for (const line of repoContent!.split('\n')) {
      lines.push(c.green(`+ ${hl(line)}`));
    }
    return lines.join('\n');
  }

  if (!systemMissing && repoMissing) {
    lines.push(c.yellow('File not yet synced to repository'));
    lines.push(c.dim('System content:'));
    for (const line of systemContent!.split('\n')) {
      lines.push(c.red(`- ${hl(line)}`));
    }
    return lines.join('\n');
  }

  if (systemMissing && repoMissing) {
    // Both sides absent — tracked but nothing to compare. Caller typically
    // filters these out via getFileDiff, but guard here so the renderer
    // never trips on undefined content.
    return lines.join('\n');
  }

  // Both present. Build rows via the shared helper and collapse long unchanged
  // runs to a single ruler row so the output stays compact on large files with
  // isolated changes. Replaces the earlier inDiff-state loop whose reset branch
  // never fired, so every line after the first change used to print as context.
  const rows = collapseUnchanged(
    buildSbsRows(systemContent!.split('\n'), repoContent!.split('\n')),
    DIFF_CONTEXT_LINES
  );

  for (const row of rows) {
    if (row.kind === 'ruler') {
      const label = `┄ ${row.skipped} unchanged line${row.skipped === 1 ? '' : 's'} ┄`;
      lines.push(c.dim(label));
      continue;
    }
    if (row.kind === 'unchanged') {
      lines.push(c.dim(`  ${hl(row.system)}`));
      continue;
    }
    if (row.kind === 'add') {
      lines.push(c.green(`+ ${hl(row.repo)}`));
      continue;
    }
    if (row.kind === 'delete') {
      lines.push(c.red(`- ${hl(row.system)}`));
      continue;
    }
    // modified: show both sides in sequence
    lines.push(c.red(`- ${hl(row.system)}`));
    lines.push(c.green(`+ ${hl(row.repo)}`));
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
    DIFF_CONTEXT_LINES
  );

  // Pad first, then highlight — the highlighter tokenises only content, not
  // the trailing spaces padOrTruncate adds, so column widths stay accurate
  // and the diff-color wrapping composes correctly around the nested tokens.
  const hl = (raw: string): string =>
    highlightLine(padOrTruncate(raw, col), diff.source);

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
      lines.push(c.dim(hl(row.system)) + '   ' + c.dim(hl(row.repo)));
      continue;
    }
    if (row.kind === 'add') {
      lines.push(
        padOrTruncate('', col) +
          ' ' + c.green('+') + ' ' +
          c.green(hl(row.repo))
      );
      continue;
    }
    if (row.kind === 'delete') {
      lines.push(
        c.red(hl(row.system)) +
          ' ' + c.red('-') + ' ' +
          padOrTruncate('', col)
      );
      continue;
    }
    // modified
    lines.push(
      c.red(hl(row.system)) +
        ' ' + c.yellow('|') + ' ' +
        c.green(hl(row.repo))
    );
  }

  return lines.join('\n');
};

interface StatLayout {
  pathWidth: number;
  countWidth: number;
  barWidth: number;
}

// Layout is computed across the full flat diff list so column widths line up
// across groups — each directory-group's rows reuse the same layout, avoiding
// a jagged per-group column.
const computeStatLayout = (diffs: FileDiff[]): StatLayout => {
  const termWidth = process.stdout.columns || 80;
  const rawMaxPath = Math.max(...diffs.map((d) => d.source.length));
  const pathWidth = Math.min(rawMaxPath, Math.max(20, Math.floor(termWidth * 0.5)));

  const maxTotal = Math.max(
    ...diffs.map((d) => {
      const s = computeDiffStats(d);
      return s.insertions + s.deletions;
    })
  );
  const countWidth = Math.max(1, maxTotal.toString().length);

  const fixedOverhead = pathWidth + countWidth + 4;
  const barWidth = Math.max(10, termWidth - fixedOverhead - 2);

  return { pathWidth, countWidth, barWidth };
};

const formatStatRows = (diffs: FileDiff[], layout: StatLayout): string => {
  const { pathWidth, countWidth, barWidth } = layout;
  const lines: string[] = [];

  for (const d of diffs) {
    const stats = computeDiffStats(d);
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

  return lines.join('\n');
};

const formatStat = (diffs: FileDiff[]): string => {
  const layout = computeStatLayout(diffs);
  const rows = formatStatRows(diffs, layout);
  const footer = ` ${formatSummaryLine(diffs.length, sumDiffStats(diffs))}`;
  return `${rows}\n\n${footer}`;
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
      // Raw diff content for piping to git tools — no clack frame.
      console.log(diff);
    } else {
      prompts.intro('tuck diff --staged');
      prompts.outro('No staged changes');
    }
    return;
  }

  // Get all tracked files
  const allFiles = await getAllTrackedFiles(tuckDir);
  const groups: DiffGroup[] = [];
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
      const result = await getFileDiffs(tuckDir, file.source);
      if (result.diffs.length === 0) continue;
      groups.push({
        diffs: result.diffs,
        directoryHeader: result.directory
          ? { source: result.directory.source, count: result.diffs.length }
          : undefined,
      });
    } catch (error) {
      if (error instanceof FileNotFoundError) {
        prompts.log.warning(`File not found: ${file.source}`);
      } else if (error instanceof PermissionError) {
        prompts.log.warning(`Permission denied: ${file.source}`);
      } else {
        throw error;
      }
    }
  }

  const allDiffs = groups.flatMap((g) => g.diffs);

  if (allDiffs.length === 0) {
    prompts.intro('tuck diff');
    prompts.outro('No differences found');
    return;
  }

  prompts.intro('tuck diff');

  // --name-only: plain path list, no stats. Pipe-friendly — emit via raw
  // console.log so each line is unprefixed. Directory groups emit their header
  // so expanded sub-files are visually attributed to the tracked directory.
  if (options.nameOnly) {
    console.log(c.bold('Changed files:'));
    for (const group of groups) {
      if (group.directoryHeader) {
        console.log(`  ${formatDirectoryHeader(group.directoryHeader)}`);
      }
      for (const diff of group.diffs) {
        const status = diff.isDirectory
          ? c.dim('[dir]')
          : diff.isBinary
            ? c.dim('[bin]')
            : '';
        console.log(`  ${c.yellow('~')} ${diff.source} ${status}`);
      }
    }
    prompts.outro(`Found ${formatCount(allDiffs.length, 'changed file')}`);
    return;
  }

  // --stat: git-style bar graph. Column widths are computed across every diff
  // (including directory sub-files) so groups line up visually. Footer prints
  // once at the end with totals across everything.
  // Output rendered via raw console.log so columns stay aligned without clack
  // gutter prefixes interfering with the bar graph layout.
  if (options.stat) {
    const layout = computeStatLayout(allDiffs);
    for (const group of groups) {
      if (group.directoryHeader) {
        console.log(formatDirectoryHeader(group.directoryHeader));
      }
      console.log(formatStatRows(group.diffs, layout));
    }
    console.log();
    console.log(` ${formatSummaryLine(allDiffs.length, sumDiffStats(allDiffs))}`);
    prompts.outro(`Found ${formatCount(allDiffs.length, 'changed file')}`);
    return;
  }

  // Full-diff mode: summary header above the per-file output so long runs show
  // their scale upfront. Binary/directory diffs contribute 0/0 to the totals.
  // Header + body emitted via raw console.log so multi-line diff content
  // doesn't get prefixed with clack gutters and stays pipe-friendly.
  const totals = sumDiffStats(allDiffs);
  console.log(c.bold(formatSummaryLine(allDiffs.length, totals)));

  // Side-by-side renders only when the terminal is wide enough — a two-column
  // layout under 80 cols truncates too aggressively to be useful. Warn the
  // user when we fall back so the flag doesn't silently no-op.
  const termWidth = process.stdout.columns || 80;
  const wantsSideBySide = options.sideBySide === true;
  const useSideBySide = wantsSideBySide && termWidth >= SBS_MIN_WIDTH;
  if (wantsSideBySide && !useSideBySide) {
    prompts.log.warning(
      `Terminal width ${termWidth} < ${SBS_MIN_WIDTH} cols — falling back to unified diff`
    );
  }

  for (const group of groups) {
    if (group.directoryHeader) {
      console.log(formatDirectoryHeader(group.directoryHeader));
      console.log();
    }
    for (const diff of group.diffs) {
      console.log(
        useSideBySide ? formatSideBySide(diff, termWidth) : formatUnifiedDiff(diff)
      );
      console.log();
    }
  }

  prompts.outro(`Found ${formatCount(allDiffs.length, 'changed file')}`);

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
