/**
 * Time Machine (snapshot/backup) module unit tests
 *
 * Tests for snapshot creation, listing, and restoration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { TEST_HOME } from '../setup.js';

// Mock fs-extra pathExists to use memfs
vi.mock('fs-extra', async () => {
  const { join, dirname } = await import('path');
  return {
    pathExists: async (path: string) => {
      const { vol } = await import('memfs');
      try {
        vol.statSync(path);
        return true;
      } catch {
        return false;
      }
    },
    ensureDir: async (dir: string) => {
      const { vol } = await import('memfs');
      vol.mkdirSync(dir, { recursive: true });
    },
    copy: async (
      src: string,
      dest: string,
      _options?: { overwrite?: boolean; preserveTimestamps?: boolean }
    ) => {
      const { vol } = await import('memfs');
      const copyRecursive = async (source: string, destination: string) => {
        const srcStats = vol.statSync(source);
        if (srcStats.isDirectory()) {
          vol.mkdirSync(destination, { recursive: true });
          const entries = vol.readdirSync(source);
          for (const entry of entries) {
            const srcPath = join(source, entry as string);
            const destPath = join(destination, entry as string);
            await copyRecursive(srcPath, destPath);
          }
        } else {
          vol.mkdirSync(dirname(destination), { recursive: true });
          vol.writeFileSync(destination, vol.readFileSync(source));
        }
      };
      await copyRecursive(src, dest);
    },
  };
});

// Import after mocking
import {
  createSnapshot,
  listSnapshots,
  getSnapshot,
  getLatestSnapshot,
  restoreSnapshot,
  restoreFileFromSnapshot,
  deleteSnapshot,
  cleanOldSnapshots,
  formatSnapshotSize,
  formatSnapshotDate,
  formatSnapshotKind,
  pruneSnapshotsByRetention,
  createPreApplySnapshot,
} from '../../src/lib/timemachine.js';

const TIMEMACHINE_DIR = join(TEST_HOME, '.tuck', 'backups');

describe('timemachine', () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync(TEST_HOME, { recursive: true });
    vol.mkdirSync(join(TEST_HOME, '.tuck'), { recursive: true });
  });

  afterEach(() => {
    vol.reset();
  });

  // ============================================================================
  // createSnapshot Tests
  // ============================================================================

  describe('createSnapshot', () => {
    it('should create a snapshot with metadata', async () => {
      // Create a test file
      const testFile = join(TEST_HOME, '.zshrc');
      vol.writeFileSync(testFile, 'export PATH=$PATH:/usr/local/bin');

      const snapshot = await createSnapshot([testFile], 'Test backup');

      expect(snapshot.id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
      expect(snapshot.reason).toBe('Test backup');
      expect(snapshot.files.length).toBe(1);
    });

    it('should copy file contents to snapshot', async () => {
      const testFile = join(TEST_HOME, '.zshrc');
      const content = 'test content';
      vol.writeFileSync(testFile, content);

      const snapshot = await createSnapshot([testFile], 'Backup');

      // Verify the backup file exists and has correct content
      const backupPath = snapshot.files[0].backupPath;
      expect(vol.existsSync(backupPath)).toBe(true);
      expect(vol.readFileSync(backupPath, 'utf-8')).toBe(content);
    });

    it('should mark non-existent files as not existing', async () => {
      const nonExistentFile = join(TEST_HOME, '.nonexistent');

      const snapshot = await createSnapshot([nonExistentFile], 'Backup');

      expect(snapshot.files[0].existed).toBe(false);
    });

    it('should create snapshot with multiple files', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'zsh content');
      vol.writeFileSync(join(TEST_HOME, '.bashrc'), 'bash content');

      const snapshot = await createSnapshot(
        [join(TEST_HOME, '.zshrc'), join(TEST_HOME, '.bashrc')],
        'Multi-file backup'
      );

      expect(snapshot.files.length).toBe(2);
    });

    it('should always keep backup paths inside snapshot files directory', async () => {
      const nestedPath = join(TEST_HOME, '.config', 'nvim', 'init.lua');
      vol.mkdirSync(join(TEST_HOME, '.config', 'nvim'), { recursive: true });
      vol.writeFileSync(nestedPath, 'set number');

      const snapshot = await createSnapshot([nestedPath], 'Path safety');

      const backupPath = snapshot.files[0].backupPath.replace(/\\/g, '/');
      const expectedPrefix = join(snapshot.path, 'files').replace(/\\/g, '/');

      expect(backupPath.startsWith(expectedPrefix + '/')).toBe(true);
      expect(backupPath).toContain('/.config/nvim/init.lua');
    });

    it('should reject snapshot paths outside home directory', async () => {
      const outsidePath = process.platform === 'win32' ? 'C:\\outside-secret' : '/outside-secret';
      vol.writeFileSync(outsidePath, 'do-not-backup');

      await expect(createSnapshot([outsidePath], 'Unsafe path')).rejects.toThrow(
        'outside home directory'
      );
    });
  });

  // ============================================================================
  // listSnapshots Tests
  // ============================================================================

  describe('listSnapshots', () => {
    it('should return empty array when no snapshots exist', async () => {
      const snapshots = await listSnapshots();
      expect(snapshots).toEqual([]);
    });

    it('should list all snapshots', async () => {
      // Create some test files
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');

      // Create a snapshot
      await createSnapshot([join(TEST_HOME, '.zshrc')], 'First');

      const snapshots = await listSnapshots();

      expect(snapshots.length).toBeGreaterThanOrEqual(1);
    });

    it('should return snapshots with valid structure', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');

      await createSnapshot([join(TEST_HOME, '.zshrc')], 'TestSnapshot');

      const snapshots = await listSnapshots();

      expect(snapshots.length).toBeGreaterThan(0);
      expect(snapshots[0]).toHaveProperty('id');
      expect(snapshots[0]).toHaveProperty('reason');
      expect(snapshots[0]).toHaveProperty('timestamp');
    });
  });

  // ============================================================================
  // getSnapshot Tests
  // ============================================================================

  describe('getSnapshot', () => {
    it('should return null for non-existent snapshot', async () => {
      const snapshot = await getSnapshot('1999-01-01-000000');
      expect(snapshot).toBeNull();
    });

    it('should return snapshot by ID', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');
      const created = await createSnapshot([join(TEST_HOME, '.zshrc')], 'Test');

      const retrieved = await getSnapshot(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.reason).toBe('Test');
    });
  });

  // ============================================================================
  // getLatestSnapshot Tests
  // ============================================================================

  describe('getLatestSnapshot', () => {
    it('should return null when no snapshots exist', async () => {
      const latest = await getLatestSnapshot();
      expect(latest).toBeNull();
    });

    it('should return the most recent snapshot', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');

      await createSnapshot([join(TEST_HOME, '.zshrc')], 'First');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await createSnapshot([join(TEST_HOME, '.zshrc')], 'Second');

      const latest = await getLatestSnapshot();

      expect(latest?.reason).toBe('Second');
    });
  });

  // ============================================================================
  // restoreSnapshot Tests
  // ============================================================================

  describe('restoreSnapshot', () => {
    it('should throw for non-existent snapshot', async () => {
      await expect(restoreSnapshot('nonexistent-id')).rejects.toThrow(
        'Snapshot not found'
      );
    });

    it('should restore files from snapshot', async () => {
      const testFile = join(TEST_HOME, '.zshrc');
      vol.writeFileSync(testFile, 'original content');

      const snapshot = await createSnapshot([testFile], 'Before changes');

      // Modify the file
      vol.writeFileSync(testFile, 'modified content');

      // Restore
      const restored = await restoreSnapshot(snapshot.id);

      expect(restored.length).toBe(1);
      expect(vol.readFileSync(testFile, 'utf-8')).toBe('original content');
    });

    it('should delete files that did not exist before', async () => {
      const newFile = join(TEST_HOME, '.new-file');

      // Create snapshot when file doesn't exist
      const snapshot = await createSnapshot([newFile], 'Before file created');

      // Create the file
      vol.writeFileSync(newFile, 'new content');

      // Restore should delete the file
      await restoreSnapshot(snapshot.id);

      expect(vol.existsSync(newFile)).toBe(false);
    });
  });

  // ============================================================================
  // restoreFileFromSnapshot Tests
  // ============================================================================

  describe('restoreFileFromSnapshot', () => {
    it('should throw for non-existent snapshot', async () => {
      await expect(
        restoreFileFromSnapshot('nonexistent-id', '~/.zshrc')
      ).rejects.toThrow('Snapshot not found');
    });

    it('should throw for file not in snapshot', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');
      const snapshot = await createSnapshot([join(TEST_HOME, '.zshrc')], 'Test');

      await expect(
        restoreFileFromSnapshot(snapshot.id, join(TEST_HOME, '.bashrc'))
      ).rejects.toThrow('File not found in snapshot');
    });

    it('should restore single file from snapshot', async () => {
      const testFile = join(TEST_HOME, '.zshrc');
      vol.writeFileSync(testFile, 'original');
      vol.writeFileSync(join(TEST_HOME, '.bashrc'), 'bash');

      const snapshot = await createSnapshot(
        [testFile, join(TEST_HOME, '.bashrc')],
        'Test'
      );

      // Modify both files
      vol.writeFileSync(testFile, 'modified zsh');
      vol.writeFileSync(join(TEST_HOME, '.bashrc'), 'modified bash');

      // Restore only zshrc
      await restoreFileFromSnapshot(snapshot.id, testFile);

      expect(vol.readFileSync(testFile, 'utf-8')).toBe('original');
      // bashrc should still be modified
      expect(vol.readFileSync(join(TEST_HOME, '.bashrc'), 'utf-8')).toBe('modified bash');
    });
  });

  // ============================================================================
  // deleteSnapshot Tests
  // ============================================================================

  describe('deleteSnapshot', () => {
    it('should delete a snapshot', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');
      const snapshot = await createSnapshot([join(TEST_HOME, '.zshrc')], 'Test');

      await deleteSnapshot(snapshot.id);

      const retrieved = await getSnapshot(snapshot.id);
      expect(retrieved).toBeNull();
    });

    it('should not throw for non-existent snapshot', async () => {
      await expect(deleteSnapshot('nonexistent')).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // cleanOldSnapshots Tests
  // ============================================================================

  describe('cleanOldSnapshots', () => {
    it('should return 0 if fewer snapshots than keep count', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');
      await createSnapshot([join(TEST_HOME, '.zshrc')], 'Only one');

      const deleted = await cleanOldSnapshots(5);

      expect(deleted).toBe(0);
    });

    it('should return number of deleted snapshots', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');
      await createSnapshot([join(TEST_HOME, '.zshrc')], 'Test');

      // If we have 1 snapshot and keep 10, nothing is deleted
      const deleted = await cleanOldSnapshots(10);

      expect(deleted).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // formatSnapshotSize Tests
  // ============================================================================

  describe('formatSnapshotSize', () => {
    it('should format 0 bytes', () => {
      expect(formatSnapshotSize(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatSnapshotSize(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatSnapshotSize(1024)).toBe('1 KB');
    });

    it('should format megabytes', () => {
      expect(formatSnapshotSize(1048576)).toBe('1 MB');
    });

    it('should format gigabytes', () => {
      expect(formatSnapshotSize(1073741824)).toBe('1 GB');
    });
  });

  // ============================================================================
  // formatSnapshotDate Tests
  // ============================================================================

  describe('formatSnapshotDate', () => {
    it('should format valid snapshot ID to date string', () => {
      const result = formatSnapshotDate('2024-06-15-143022');
      // Result should be a locale string, just verify it's transformed
      expect(result).not.toBe('2024-06-15-143022');
    });

    it('should return original string for invalid format', () => {
      const result = formatSnapshotDate('invalid-id');
      expect(result).toBe('invalid-id');
    });
  });

  // ============================================================================
  // Snapshot kind Tests
  // ============================================================================

  describe('snapshot kind', () => {
    it('defaults new snapshots to kind "manual" when no kind is given', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');
      const snapshot = await createSnapshot(
        [join(TEST_HOME, '.zshrc')],
        'manual backup'
      );
      expect(snapshot.kind).toBe('manual');
    });

    it('persists kind in metadata and exposes it via listSnapshots', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');
      await createSnapshot(
        [join(TEST_HOME, '.zshrc')],
        'Pre-restore snapshot',
        { kind: 'restore' }
      );

      const [snap] = await listSnapshots();
      expect(snap.kind).toBe('restore');
    });

    it('exposes kind via getSnapshot', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');
      const created = await createSnapshot(
        [join(TEST_HOME, '.zshrc')],
        'Pre-sync snapshot',
        { kind: 'sync' }
      );

      const retrieved = await getSnapshot(created.id);
      expect(retrieved?.kind).toBe('sync');
    });

    it('falls back to "apply" for legacy snapshots missing a kind field', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');
      const snapshot = await createSnapshot(
        [join(TEST_HOME, '.zshrc')],
        'legacy apply snapshot',
        { kind: 'apply' }
      );

      // Simulate an older snapshot by stripping `kind` from its metadata on disk.
      const metadataPath = join(snapshot.path, 'metadata.json');
      const parsed = JSON.parse(vol.readFileSync(metadataPath, 'utf-8') as string);
      delete parsed.kind;
      vol.writeFileSync(metadataPath, JSON.stringify(parsed));

      const retrieved = await getSnapshot(snapshot.id);
      expect(retrieved?.kind).toBe('apply');
    });

    it('createPreApplySnapshot tags snapshots with kind="apply"', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');
      const snap = await createPreApplySnapshot(
        [join(TEST_HOME, '.zshrc')],
        'someone/dotfiles'
      );
      expect(snap.kind).toBe('apply');
      expect(snap.reason).toMatch(/someone\/dotfiles/);
    });
  });

  // ============================================================================
  // formatSnapshotKind Tests
  // ============================================================================

  describe('formatSnapshotKind', () => {
    it('returns the kind label for each known kind', () => {
      expect(formatSnapshotKind('apply')).toBe('apply');
      expect(formatSnapshotKind('restore')).toBe('restore');
      expect(formatSnapshotKind('sync')).toBe('sync');
      expect(formatSnapshotKind('remove')).toBe('remove');
      expect(formatSnapshotKind('clean')).toBe('clean');
      expect(formatSnapshotKind('manual')).toBe('manual');
    });

    it('falls back to "apply" for undefined (legacy snapshots)', () => {
      expect(formatSnapshotKind(undefined)).toBe('apply');
    });
  });

  // ============================================================================
  // pruneSnapshotsByRetention Tests
  // ============================================================================

  describe('pruneSnapshotsByRetention', () => {
    it('is a no-op when both maxCount and maxAgeDays are undefined', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');
      await createSnapshot([join(TEST_HOME, '.zshrc')], 'one');

      const deleted = await pruneSnapshotsByRetention({});

      expect(deleted).toBe(0);
      const remaining = await listSnapshots();
      expect(remaining.length).toBe(1);
    });

    it('keeps only maxCount newest snapshots (count-based prune)', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');

      // Create 4 snapshots — each sleep ensures a distinct timestamp ID.
      for (let i = 0; i < 4; i++) {
        await createSnapshot([join(TEST_HOME, '.zshrc')], `snap ${i}`);
        await new Promise((r) => setTimeout(r, 1100));
      }

      const deleted = await pruneSnapshotsByRetention({ maxCount: 2 });
      expect(deleted).toBe(2);

      const remaining = await listSnapshots();
      expect(remaining.length).toBe(2);
      // Newest two should survive
      expect(remaining[0].reason).toBe('snap 3');
      expect(remaining[1].reason).toBe('snap 2');
    }, 10000);

    it('deletes snapshots older than maxAgeDays', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');

      // Fresh snapshot — should survive a 7-day cutoff.
      const fresh = await createSnapshot([join(TEST_HOME, '.zshrc')], 'fresh');

      // Snapshot IDs are second-granular, so sleep > 1s to get a distinct ID.
      await new Promise((r) => setTimeout(r, 1100));
      const ancient = await createSnapshot([join(TEST_HOME, '.zshrc')], 'ancient');
      const ancientMeta = join(ancient.path, 'metadata.json');
      const parsed = JSON.parse(vol.readFileSync(ancientMeta, 'utf-8') as string);
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      parsed.timestamp = tenDaysAgo;
      vol.writeFileSync(ancientMeta, JSON.stringify(parsed));

      const deleted = await pruneSnapshotsByRetention({ maxAgeDays: 7 });
      expect(deleted).toBe(1);

      const remaining = await listSnapshots();
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(fresh.id);
    }, 5000);

    it('treats maxCount=0 and maxAgeDays=0 as disabled', async () => {
      vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'content');
      await createSnapshot([join(TEST_HOME, '.zshrc')], 'keep me');

      const deleted = await pruneSnapshotsByRetention({
        maxCount: 0,
        maxAgeDays: 0,
      });

      expect(deleted).toBe(0);
      const remaining = await listSnapshots();
      expect(remaining.length).toBe(1);
    });
  });
});
