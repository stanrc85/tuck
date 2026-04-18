import { join, relative, sep } from 'path';
import { readdir, rm, stat } from 'fs/promises';
import {
  getFilesDir,
  getSafeRepoPathFromDestination,
  pathExists,
} from './paths.js';
import { loadManifest } from './manifest.js';

export interface OrphanFile {
  absolutePath: string;
  relativePath: string;
  size: number;
}

export interface MissingTracked {
  id: string;
  source: string;
  destination: string;
}

export interface OrphanScanResult {
  orphanFiles: OrphanFile[];
  /** Absolute paths of directories that will be empty after orphan removal. */
  orphanDirs: string[];
  /** Manifest entries whose destination no longer exists on disk. */
  missingFromDisk: MissingTracked[];
  totalSize: number;
}

/**
 * Walk `.tuck/files/` and classify every file as tracked or orphaned against
 * the manifest's tracked destinations. A "tracked destination" is either a
 * tracked file path or a tracked directory (everything under it is implicitly
 * tracked). Inverse check: report manifest entries whose destination is missing
 * from disk.
 */
export const scanOrphans = async (tuckDir: string): Promise<OrphanScanResult> => {
  const filesDir = getFilesDir(tuckDir);
  if (!(await pathExists(filesDir))) {
    return { orphanFiles: [], orphanDirs: [], missingFromDisk: [], totalSize: 0 };
  }

  const manifest = await loadManifest(tuckDir);
  const trackedAbsolute: string[] = [];
  const missingFromDisk: MissingTracked[] = [];

  for (const [id, file] of Object.entries(manifest.files)) {
    const abs = getSafeRepoPathFromDestination(tuckDir, file.destination);
    trackedAbsolute.push(abs);
    if (!(await pathExists(abs))) {
      missingFromDisk.push({ id, source: file.source, destination: file.destination });
    }
  }

  const isUnder = (candidate: string, parent: string): boolean =>
    candidate === parent || candidate.startsWith(parent + sep);

  const isPathTracked = (absPath: string): boolean =>
    trackedAbsolute.some((t) => isUnder(absPath, t));

  const dirHasTrackedContent = (dirPath: string): boolean =>
    trackedAbsolute.some((t) => isUnder(t, dirPath));

  const orphanFiles: OrphanFile[] = [];
  const orphanDirs: string[] = [];

  const pushOrphanFile = async (abs: string): Promise<void> => {
    let size = 0;
    try {
      size = (await stat(abs)).size;
    } catch {
      // File disappeared between readdir and stat — skip
    }
    orphanFiles.push({
      absolutePath: abs,
      relativePath: relative(tuckDir, abs),
      size,
    });
  };

  const collectOrphansUnder = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        await pushOrphanFile(abs);
        continue;
      }
      if (entry.isDirectory()) {
        await collectOrphansUnder(abs);
        continue;
      }
      if (entry.isFile()) {
        await pushOrphanFile(abs);
      }
    }
  };

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        if (!isPathTracked(abs)) {
          await pushOrphanFile(abs);
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (isPathTracked(abs)) {
          // Entire directory is a tracked destination — skip.
          continue;
        }
        if (!dirHasTrackedContent(abs)) {
          // Nothing under this directory is tracked — everything is orphan.
          await collectOrphansUnder(abs);
          orphanDirs.push(abs);
          continue;
        }
        // Mixed: descend and inspect individually.
        await walk(abs);
        continue;
      }

      if (entry.isFile()) {
        if (!isPathTracked(abs)) {
          await pushOrphanFile(abs);
        }
      }
    }
  };

  await walk(filesDir);

  const totalSize = orphanFiles.reduce((sum, f) => sum + f.size, 0);

  return { orphanFiles, orphanDirs, missingFromDisk, totalSize };
};

/**
 * Delete every orphan file and remove directories that are left empty.
 * Deepest directories first so parents clean up cleanly.
 */
export const deleteOrphans = async (result: OrphanScanResult): Promise<void> => {
  for (const file of result.orphanFiles) {
    if (await pathExists(file.absolutePath)) {
      await rm(file.absolutePath, { recursive: true, force: true });
    }
  }

  const sortedDirs = [...result.orphanDirs].sort((a, b) => b.length - a.length);
  for (const dir of sortedDirs) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Parent may have already removed it.
    }
  }
};
