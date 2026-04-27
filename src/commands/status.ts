/**
 * Status command for tuck CLI
 * Shows current tracking status in a compact, modern layout
 */

import { Command } from 'commander';
import figures from 'figures';
import { colors as c, indent, formatStatus, categoryStyles, formatCount } from '../ui/index.js';
import { prompts } from '../ui/prompts.js';
import {
  getTuckDir,
  collapsePath,
  expandPath,
  pathExists,
  validateSafeSourcePath,
  getSafeRepoPathFromDestination,
} from '../lib/paths.js';
import { loadManifest, getAllTrackedFiles, assertMigrated } from '../lib/manifest.js';
import { getStatus, hasRemote, getRemoteUrl, getCurrentBranch } from '../lib/git.js';
import { getFileChecksum } from '../lib/files.js';
import { loadTuckignore } from '../lib/tuckignore.js';
import { NotInitializedError } from '../errors.js';
import { VERSION } from '../constants.js';
import type { StatusOptions, FileChange } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TuckStatus {
  tuckDir: string;
  branch: string;
  remote?: string;
  remoteStatus: 'up-to-date' | 'ahead' | 'behind' | 'diverged' | 'no-remote';
  ahead: number;
  behind: number;
  trackedCount: number;
  categoryCounts: Record<string, number>;
  changes: FileChange[];
  gitChanges: {
    staged: string[];
    modified: string[];
    untracked: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Detection
// ─────────────────────────────────────────────────────────────────────────────

export const detectFileChanges = async (tuckDir: string): Promise<FileChange[]> => {
  const files = await getAllTrackedFiles(tuckDir);
  const ignoredPaths = await loadTuckignore(tuckDir);
  const changes: FileChange[] = [];

  for (const [, file] of Object.entries(files)) {
    validateSafeSourcePath(file.source);
    getSafeRepoPathFromDestination(tuckDir, file.destination);

    if (ignoredPaths.has(file.source)) {
      continue;
    }

    const sourcePath = expandPath(file.source);

    if (!(await pathExists(sourcePath))) {
      changes.push({
        path: file.source,
        status: 'deleted',
        source: file.source,
        destination: file.destination,
      });
      continue;
    }

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

const getFullStatus = async (tuckDir: string): Promise<TuckStatus> => {
  const manifest = await loadManifest(tuckDir);
  const gitStatus = await getStatus(tuckDir);
  const branch = await getCurrentBranch(tuckDir);
  const hasRemoteRepo = await hasRemote(tuckDir);
  const remoteUrl = hasRemoteRepo ? await getRemoteUrl(tuckDir) : undefined;

  let remoteStatus: TuckStatus['remoteStatus'] = 'no-remote';
  if (hasRemoteRepo) {
    if (gitStatus.ahead > 0 && gitStatus.behind > 0) {
      remoteStatus = 'diverged';
    } else if (gitStatus.ahead > 0) {
      remoteStatus = 'ahead';
    } else if (gitStatus.behind > 0) {
      remoteStatus = 'behind';
    } else {
      remoteStatus = 'up-to-date';
    }
  }

  const fileChanges = await detectFileChanges(tuckDir);

  const categoryCounts: Record<string, number> = {};
  for (const file of Object.values(manifest.files)) {
    categoryCounts[file.category] = (categoryCounts[file.category] || 0) + 1;
  }

  return {
    tuckDir,
    branch,
    remote: remoteUrl || undefined,
    remoteStatus,
    ahead: gitStatus.ahead,
    behind: gitStatus.behind,
    trackedCount: Object.keys(manifest.files).length,
    categoryCounts,
    changes: fileChanges,
    gitChanges: {
      staged: gitStatus.staged,
      modified: gitStatus.modified,
      untracked: gitStatus.untracked,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Output Formatting
// ─────────────────────────────────────────────────────────────────────────────

const formatRemoteUrl = (url: string): string => {
  // Shorten common patterns
  return url
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
    .replace(/^github\.com\//, '');
};

const formatRemoteStatusLine = (status: TuckStatus): { kind: 'success' | 'warning' | 'error'; msg: string } | null => {
  if (!status.remote) return null;
  switch (status.remoteStatus) {
    case 'up-to-date':
      return { kind: 'success', msg: 'Up to date with remote' };
    case 'ahead':
      return {
        kind: 'warning',
        msg: `${figures.arrowUp} ${formatCount(status.ahead, 'commit')} ahead`,
      };
    case 'behind':
      return {
        kind: 'warning',
        msg: `${figures.arrowDown} ${formatCount(status.behind, 'commit')} behind`,
      };
    case 'diverged':
      return {
        kind: 'error',
        msg: `Diverged (${status.ahead} ahead, ${status.behind} behind)`,
      };
    default:
      return null;
  }
};

const pickNextStep = (status: TuckStatus): string => {
  if (status.changes.length > 0) return 'Run `tuck sync` to commit changes';
  if (status.remoteStatus === 'ahead') return 'Run `tuck push` to push changes';
  if (status.remoteStatus === 'behind') return 'Run `tuck pull` to pull changes';
  if (status.trackedCount === 0) return 'Run `tuck add <path>` to start tracking';
  return 'Everything up to date';
};

const printStatus = (status: TuckStatus): void => {
  prompts.intro(`tuck status ${c.muted(`v${VERSION}`)}`);

  // Header info as a single dim block
  const headerLines: string[] = [
    `Repository: ${collapsePath(status.tuckDir)}`,
    `Branch:     ${c.brand(status.branch)}`,
  ];
  if (status.remote) {
    headerLines.push(`Remote:     ${formatRemoteUrl(status.remote)}`);
  } else {
    headerLines.push(`Remote:     ${c.warning('not configured')}`);
  }
  prompts.log.message(c.dim(headerLines.join('\n')));

  // Remote sync status
  const remoteLine = formatRemoteStatusLine(status);
  if (remoteLine) {
    prompts.log[remoteLine.kind](remoteLine.msg);
  }

  // Tracked files summary + category breakdown as one block
  const categoryOrder = ['shell', 'git', 'editors', 'terminal', 'ssh', 'misc'];
  const sortedCategories = Object.keys(status.categoryCounts).sort((a, b) => {
    const aIdx = categoryOrder.indexOf(a);
    const bIdx = categoryOrder.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  const summaryLines: string[] = [`${formatCount(status.trackedCount, 'file')} tracked`];
  if (sortedCategories.length > 0) {
    const categoryLine = sortedCategories
      .map((cat) => {
        const style = categoryStyles[cat] || categoryStyles.misc;
        const count = status.categoryCounts[cat];
        return `${style.color(style.icon)} ${cat}: ${count}`;
      })
      .join('  ');
    summaryLines.push(c.muted(indent() + categoryLine));
  }
  prompts.log.message(summaryLines.join('\n'));

  // File changes
  if (status.changes.length > 0) {
    const changeLines = [c.bold('Changes:')];
    for (const change of status.changes) {
      changeLines.push(`${indent()}${formatStatus(change.status)} ${c.brand(change.path)}`);
    }
    prompts.log.warning(changeLines.join('\n'));
  }

  // Git changes
  const hasGitChanges =
    status.gitChanges.staged.length > 0 ||
    status.gitChanges.modified.length > 0 ||
    status.gitChanges.untracked.length > 0;

  if (hasGitChanges) {
    const repoLines: string[] = [c.bold('Repository:')];

    if (status.gitChanges.staged.length > 0) {
      repoLines.push(c.success(`${indent()}Staged:`));
      status.gitChanges.staged.forEach((f) =>
        repoLines.push(c.success(`${indent()}${indent()}+ ${f}`))
      );
    }

    if (status.gitChanges.modified.length > 0) {
      repoLines.push(c.warning(`${indent()}Modified:`));
      status.gitChanges.modified.forEach((f) =>
        repoLines.push(c.warning(`${indent()}${indent()}~ ${f}`))
      );
    }

    if (status.gitChanges.untracked.length > 0) {
      repoLines.push(c.muted(`${indent()}Untracked:`));
      status.gitChanges.untracked.forEach((f) =>
        repoLines.push(c.muted(`${indent()}${indent()}? ${f}`))
      );
    }

    prompts.log.message(repoLines.join('\n'));
  }

  prompts.outro(pickNextStep(status));
};

const printShortStatus = (status: TuckStatus): void => {
  const parts: string[] = [];

  parts.push(`[${status.branch}]`);

  if (status.remoteStatus === 'ahead') {
    parts.push(c.warning(`${figures.arrowUp}${status.ahead}`));
  } else if (status.remoteStatus === 'behind') {
    parts.push(c.warning(`${figures.arrowDown}${status.behind}`));
  } else if (status.remoteStatus === 'diverged') {
    parts.push(c.error(`${figures.arrowUp}${status.ahead}${figures.arrowDown}${status.behind}`));
  }

  if (status.changes.length > 0) {
    const modified = status.changes.filter((ch) => ch.status === 'modified').length;
    const deleted = status.changes.filter((ch) => ch.status === 'deleted').length;
    if (modified > 0) parts.push(c.warning(`~${modified}`));
    if (deleted > 0) parts.push(c.error(`-${deleted}`));
  }

  parts.push(c.muted(`(${status.trackedCount} tracked)`));

  console.log(parts.join(' '));
};

const printJsonStatus = (status: TuckStatus): void => {
  console.log(JSON.stringify(status, null, 2));
};

// ─────────────────────────────────────────────────────────────────────────────
// Command Implementation
// ─────────────────────────────────────────────────────────────────────────────

export const runStatus = async (options: StatusOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);

  const status = await getFullStatus(tuckDir);

  if (options.json) {
    printJsonStatus(status);
  } else if (options.short) {
    printShortStatus(status);
  } else {
    printStatus(status);
  }
};

export const statusCommand = new Command('status')
  .description('Show current tracking status')
  .option('--short', 'Short format')
  .option('--json', 'Output as JSON')
  .action(async (options: StatusOptions) => {
    await runStatus(options);
  });
