import { execFile } from 'child_process';
import { join, dirname, relative, resolve, sep } from 'path';
import { readdir, readFile, writeFile, rm, stat, rename } from 'fs/promises';
import { copy, ensureDir, pathExists } from 'fs-extra';
import { homedir } from 'os';
import { promisify } from 'util';
import { expandPath, pathExists as checkPathExists } from './paths.js';
import { loadConfig } from './config.js';
import { BACKUP_DIR, DEFAULT_TUCK_DIR } from '../constants.js';
import { BackupError } from '../errors.js';

const execFileAsync = promisify(execFile);

/**
 * Snapshots live outside `~/.tuck/` so they stay per-host and never leak into
 * the synced dotfiles repo. The v1.x location was `~/.tuck/backups/`; see
 * `migrateTimemachineLocation` below for the one-time move.
 */
const TIMEMACHINE_DIR = expandPath(BACKUP_DIR);
const LEGACY_TIMEMACHINE_DIR = join(homedir(), '.tuck', 'backups');

let migrationAttempted = false;

/**
 * One-time migration from the v1.x `~/.tuck/backups/` location to the
 * per-host `~/.tuck-backups/` location introduced in v2.0.0. Moves any
 * existing snapshots, best-effort untracks `backups/` from the tuck git repo
 * (so the next `tuck sync` stops committing them), then removes the empty
 * legacy directory. Idempotent and safe to call from every `createSnapshot`.
 */
export const migrateTimemachineLocation = async (
  tuckDir: string = DEFAULT_TUCK_DIR
): Promise<void> => {
  if (migrationAttempted) return;
  migrationAttempted = true;

  if (!(await pathExists(LEGACY_TIMEMACHINE_DIR))) {
    return;
  }

  try {
    await ensureDir(TIMEMACHINE_DIR);
    const entries = await readdir(LEGACY_TIMEMACHINE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      const src = join(LEGACY_TIMEMACHINE_DIR, entry.name);
      const dest = join(TIMEMACHINE_DIR, entry.name);
      if (await pathExists(dest)) {
        // Destination already has a snapshot with this ID — skip to avoid
        // clobbering a newer-layout snapshot with a legacy one of the same name.
        continue;
      }
      await rename(src, dest).catch(async () => {
        // Cross-device rename fails with EXDEV; fall back to copy + remove.
        await copy(src, dest, { overwrite: false });
        await rm(src, { recursive: true, force: true });
      });
    }
  } catch {
    // Best-effort migration. If it fails, new snapshots still write to the new
    // location; legacy snapshots stay put and can be moved manually.
    return;
  }

  // Best-effort: untrack `backups/` from the tuck repo if git previously
  // committed it. Silences `git rm` stderr; failure is fine (not a git repo,
  // nothing tracked, etc.).
  try {
    await execFileAsync('git', ['rm', '--cached', '-r', '-f', '--ignore-unmatch', 'backups/'], {
      cwd: tuckDir,
    });
  } catch {
    // ignore
  }

  // Remove the empty legacy directory.
  try {
    await rm(LEGACY_TIMEMACHINE_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
};

/**
 * Reset the module-level migration flag. Test-only escape hatch so each
 * test case gets a fresh migration attempt.
 */
export const resetTimemachineMigrationState = (): void => {
  migrationAttempted = false;
};

/**
 * Categorises a snapshot by the operation that created it. Drives the
 * label shown in `tuck undo --list` / interactive mode so users can tell
 * a pre-apply backup apart from a pre-sync or pre-remove one.
 */
export type SnapshotKind =
  | 'apply'
  | 'restore'
  | 'sync'
  | 'remove'
  | 'clean'
  | 'manual'
  | 'validate-fix'
  | 'optimize-auto';

export interface SnapshotMetadata {
  id: string;
  timestamp: string;
  reason: string;
  files: SnapshotFile[];
  machine: string;
  profile?: string;
  /** Optional on disk for backward-compat; pre-kind snapshots default to 'apply'. */
  kind?: SnapshotKind;
}

export interface SnapshotFile {
  originalPath: string;
  backupPath: string;
  existed: boolean;
}

export interface Snapshot {
  id: string;
  path: string;
  timestamp: Date;
  reason: string;
  files: SnapshotFile[];
  machine: string;
  profile?: string;
  kind: SnapshotKind;
}

export interface CreateSnapshotOptions {
  kind?: SnapshotKind;
  profile?: string;
}

const DEFAULT_KIND: SnapshotKind = 'apply';

/**
 * Generate a unique snapshot ID (YYYY-MM-DD-HHMMSS)
 */
const generateSnapshotId = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
};

/**
 * Get the path to a snapshot directory
 */
const getSnapshotPath = (snapshotId: string): string => {
  return join(TIMEMACHINE_DIR, snapshotId);
};

/**
 * Convert original path to a safe backup path, preserving directory structure
 * to prevent filename collisions. The path is relative to the backup files directory.
 * e.g., ~/.zshrc -> .zshrc
 * e.g., ~/.config/nvim -> .config/nvim
 * e.g., ~/.foo.bar -> .foo.bar (distinct from ~/.foo-bar -> .foo-bar)
 */
const toBackupPath = (originalPath: string): string => {
  const expandedOriginal = expandPath(originalPath);
  const homePath = resolve(homedir());
  const resolvedOriginal = resolve(expandedOriginal);

  const isWithinHome =
    resolvedOriginal === homePath || resolvedOriginal.startsWith(homePath + sep);
  if (!isWithinHome) {
    throw new BackupError(`Cannot snapshot path outside home directory: ${originalPath}`);
  }

  const relativePath = relative(homePath, resolvedOriginal);
  const normalizedRelative = relativePath.replace(/\\/g, '/');

  if (!normalizedRelative || normalizedRelative === '.') {
    throw new BackupError(`Cannot snapshot home directory root directly: ${originalPath}`);
  }

  if (
    normalizedRelative.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(normalizedRelative) ||
    normalizedRelative.split('/').includes('..')
  ) {
    throw new BackupError(`Unsafe backup path generated from: ${originalPath}`);
  }

  return normalizedRelative;
};

/**
 * Create a Time Machine snapshot of multiple files. `options.kind` tags the
 * snapshot so `tuck undo` can present it with the right context ("Pre-apply",
 * "Pre-sync", etc.); defaults to `'manual'` for ad-hoc callers.
 */
export const createSnapshot = async (
  filePaths: string[],
  reason: string,
  options: CreateSnapshotOptions = {}
): Promise<Snapshot> => {
  await migrateTimemachineLocation();

  const snapshotId = generateSnapshotId();
  const snapshotPath = getSnapshotPath(snapshotId);
  const kind: SnapshotKind = options.kind ?? 'manual';

  await ensureDir(snapshotPath);

  const files: SnapshotFile[] = [];
  const machine = (await import('os')).hostname();

  for (const filePath of filePaths) {
    const expandedPath = expandPath(filePath);
    const backupRelativePath = toBackupPath(expandedPath);
    const backupPath = join(snapshotPath, 'files', backupRelativePath);

    const existed = await checkPathExists(expandedPath);

    if (existed) {
      await ensureDir(dirname(backupPath));
      await copy(expandedPath, backupPath, { overwrite: true, preserveTimestamps: true });
    }

    files.push({
      originalPath: expandedPath,
      backupPath,
      existed,
    });
  }

  // Save metadata
  const metadata: SnapshotMetadata = {
    id: snapshotId,
    timestamp: new Date().toISOString(),
    reason,
    files,
    machine,
    profile: options.profile,
    kind,
  };

  await writeFile(
    join(snapshotPath, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf-8'
  );

  return {
    id: snapshotId,
    path: snapshotPath,
    timestamp: new Date(metadata.timestamp),
    reason,
    files,
    machine,
    profile: options.profile,
    kind,
  };
};

/**
 * Create a snapshot of the user's current dotfiles before applying new ones
 */
export const createPreApplySnapshot = async (
  targetPaths: string[],
  sourceRepo?: string
): Promise<Snapshot> => {
  const reason = sourceRepo
    ? `Pre-apply backup before applying from ${sourceRepo}`
    : 'Pre-apply backup';

  return createSnapshot(targetPaths, reason, { kind: 'apply' });
};

/**
 * List all available snapshots
 */
export const listSnapshots = async (): Promise<Snapshot[]> => {
  await migrateTimemachineLocation();

  if (!(await pathExists(TIMEMACHINE_DIR))) {
    return [];
  }

  const entries = await readdir(TIMEMACHINE_DIR, { withFileTypes: true });
  const snapshots: Snapshot[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const snapshotPath = join(TIMEMACHINE_DIR, entry.name);
    const metadataPath = join(snapshotPath, 'metadata.json');

    if (!(await pathExists(metadataPath))) continue;

    try {
      const content = await readFile(metadataPath, 'utf-8');
      const metadata: SnapshotMetadata = JSON.parse(content);

      snapshots.push({
        id: metadata.id,
        path: snapshotPath,
        timestamp: new Date(metadata.timestamp),
        reason: metadata.reason,
        files: metadata.files,
        machine: metadata.machine,
        profile: metadata.profile,
        kind: metadata.kind ?? DEFAULT_KIND,
      });
    } catch (error) {
      // Skip invalid snapshots
      if (process.env.DEBUG) {
        console.warn(`[tuck] Warning: Skipping invalid snapshot:`, error);
      }
    }
  }

  // Sort by timestamp, newest first
  return snapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
};

/**
 * Get a specific snapshot by ID
 */
export const getSnapshot = async (snapshotId: string): Promise<Snapshot | null> => {
  const snapshotPath = getSnapshotPath(snapshotId);

  if (!(await pathExists(snapshotPath))) {
    return null;
  }

  const metadataPath = join(snapshotPath, 'metadata.json');

  if (!(await pathExists(metadataPath))) {
    return null;
  }

  try {
    const content = await readFile(metadataPath, 'utf-8');
    const metadata: SnapshotMetadata = JSON.parse(content);

    return {
      id: metadata.id,
      path: snapshotPath,
      timestamp: new Date(metadata.timestamp),
      reason: metadata.reason,
      files: metadata.files,
      machine: metadata.machine,
      profile: metadata.profile,
      kind: metadata.kind ?? DEFAULT_KIND,
    };
  } catch {
    return null;
  }
};

/**
 * Get the latest snapshot
 */
export const getLatestSnapshot = async (): Promise<Snapshot | null> => {
  const snapshots = await listSnapshots();
  return snapshots.length > 0 ? snapshots[0] : null;
};

/**
 * Restore all files from a snapshot
 */
export const restoreSnapshot = async (snapshotId: string): Promise<string[]> => {
  const snapshot = await getSnapshot(snapshotId);

  if (!snapshot) {
    throw new BackupError(`Snapshot not found: ${snapshotId}`, [
      'Run `tuck restore --list` to see available snapshots',
    ]);
  }

  const restoredFiles: string[] = [];

  for (const file of snapshot.files) {
    if (!file.existed) {
      // File didn't exist before, delete it if it exists now
      if (await checkPathExists(file.originalPath)) {
        await rm(file.originalPath, { recursive: true });
      }
      continue;
    }

    // Restore the backup
    if (await pathExists(file.backupPath)) {
      await ensureDir(dirname(file.originalPath));
      await copy(file.backupPath, file.originalPath, { overwrite: true, preserveTimestamps: true });
      restoredFiles.push(file.originalPath);
    }
  }

  return restoredFiles;
};

/**
 * Restore a single file from a snapshot
 */
export const restoreFileFromSnapshot = async (
  snapshotId: string,
  filePath: string
): Promise<boolean> => {
  const snapshot = await getSnapshot(snapshotId);

  if (!snapshot) {
    throw new BackupError(`Snapshot not found: ${snapshotId}`);
  }

  const expandedPath = expandPath(filePath);
  const file = snapshot.files.find((f) => f.originalPath === expandedPath);

  if (!file) {
    throw new BackupError(`File not found in snapshot: ${filePath}`, [
      'This file was not included in the snapshot',
    ]);
  }

  if (!file.existed) {
    // File didn't exist before, delete it if it exists now
    if (await checkPathExists(file.originalPath)) {
      await rm(file.originalPath, { recursive: true });
    }
    return true;
  }

  if (!(await pathExists(file.backupPath))) {
    throw new BackupError(`Backup file is missing: ${file.backupPath}`);
  }

  await ensureDir(dirname(file.originalPath));
  await copy(file.backupPath, file.originalPath, { overwrite: true, preserveTimestamps: true });
  return true;
};

/**
 * Delete a snapshot
 */
export const deleteSnapshot = async (snapshotId: string): Promise<void> => {
  const snapshotPath = getSnapshotPath(snapshotId);

  if (await pathExists(snapshotPath)) {
    await rm(snapshotPath, { recursive: true });
  }
};

/**
 * Clean up old snapshots, keeping only the specified number
 */
export const cleanOldSnapshots = async (keepCount: number): Promise<number> => {
  const snapshots = await listSnapshots();

  if (snapshots.length <= keepCount) {
    return 0;
  }

  const toDelete = snapshots.slice(keepCount);
  let deletedCount = 0;

  for (const snapshot of toDelete) {
    await deleteSnapshot(snapshot.id);
    deletedCount++;
  }

  return deletedCount;
};

export interface PruneRetentionOptions {
  /** Keep at most this many snapshots. Older ones are deleted. Use 0 to disable. */
  maxCount?: number;
  /** Delete snapshots older than this many days. Use 0 to disable. */
  maxAgeDays?: number;
}

/**
 * Delete snapshots that fall outside the retention policy. Age-based pruning
 * runs first, then count-based pruning keeps the newest `maxCount` of what's
 * left. Returns the number of snapshots deleted.
 *
 * Passing `undefined` for either option disables that dimension; passing both
 * as `undefined` is a no-op (returns 0 without touching disk).
 */
export const pruneSnapshotsByRetention = async (
  options: PruneRetentionOptions
): Promise<number> => {
  const { maxCount, maxAgeDays } = options;
  if (maxCount === undefined && maxAgeDays === undefined) {
    return 0;
  }

  const snapshots = await listSnapshots();
  const toDelete = new Set<string>();

  if (maxAgeDays !== undefined && maxAgeDays > 0) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    for (const snapshot of snapshots) {
      if (snapshot.timestamp.getTime() < cutoff) {
        toDelete.add(snapshot.id);
      }
    }
  }

  if (maxCount !== undefined && maxCount > 0) {
    const survivors = snapshots.filter((s) => !toDelete.has(s.id));
    if (survivors.length > maxCount) {
      for (const snapshot of survivors.slice(maxCount)) {
        toDelete.add(snapshot.id);
      }
    }
  }

  for (const id of toDelete) {
    await deleteSnapshot(id);
  }

  return toDelete.size;
};

/**
 * Read retention policy from the config at `tuckDir` and prune accordingly.
 * Commands call this after creating a snapshot so backup disk usage stays
 * bounded without requiring a manual `tuck undo --delete` flow.
 */
export const pruneSnapshotsFromConfig = async (tuckDir: string): Promise<number> => {
  try {
    const config = await loadConfig(tuckDir);
    return await pruneSnapshotsByRetention({
      maxCount: config.snapshots?.maxCount,
      maxAgeDays: config.snapshots?.maxAgeDays,
    });
  } catch {
    // Don't let pruning failures crash a destructive command — the snapshot
    // itself already succeeded, and the user can run `tuck undo --delete` manually.
    return 0;
  }
};

/**
 * Get the total size of all snapshots in bytes
 */
export const getSnapshotsSize = async (): Promise<number> => {
  if (!(await pathExists(TIMEMACHINE_DIR))) {
    return 0;
  }

  let totalSize = 0;

  const calculateDirSize = async (dirPath: string): Promise<number> => {
    let size = 0;
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += await calculateDirSize(entryPath);
      } else {
        const stats = await stat(entryPath);
        size += stats.size;
      }
    }

    return size;
  };

  totalSize = await calculateDirSize(TIMEMACHINE_DIR);
  return totalSize;
};

/**
 * Format bytes to human readable string
 */
export const formatSnapshotSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

/**
 * Human-friendly label for a snapshot kind, used in `tuck undo` UI.
 */
export const formatSnapshotKind = (kind: SnapshotKind | undefined): string => {
  switch (kind ?? DEFAULT_KIND) {
    case 'apply':
      return 'apply';
    case 'restore':
      return 'restore';
    case 'sync':
      return 'sync';
    case 'remove':
      return 'remove';
    case 'clean':
      return 'clean';
    case 'manual':
      return 'manual';
    case 'validate-fix':
      return 'validate-fix';
    case 'optimize-auto':
      return 'optimize-auto';
    default:
      return String(kind);
  }
};

/**
 * Format a snapshot ID to a human-readable date string
 */
export const formatSnapshotDate = (snapshotId: string): string => {
  // Parse YYYY-MM-DD-HHMMSS format
  const match = snapshotId.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!match) return snapshotId;

  const [, year, month, day, hours, minutes, seconds] = match;
  const date = new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hours),
    parseInt(minutes),
    parseInt(seconds)
  );

  return date.toLocaleString();
};
