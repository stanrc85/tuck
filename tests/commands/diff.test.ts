import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { clearManifestCache } from '../../src/lib/manifest.js';
import { TEST_TUCK_DIR } from '../setup.js';
import { createMockManifest, createMockTrackedFile } from '../utils/factories.js';

interface TestFileDiff {
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

// Mock UI
vi.mock('../../src/ui/index.js', () => ({
  prompts: {
    intro: vi.fn(),
    outro: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true),
    select: vi.fn().mockResolvedValue('general'),
    text: vi.fn(),
    log: {
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      step: vi.fn(),
    },
    note: vi.fn(),
    cancel: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      message: '',
    })),
  },
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('diff command', () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    clearManifestCache();
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
  });

  afterEach(() => {
    vol.reset();
    clearManifestCache();
  });

  describe('diff formatting', () => {
    it('should format file missing on system correctly', async () => {
      const { formatUnifiedDiff } = await import('../../src/commands/diff.js');

      const diff: TestFileDiff = {
        source: '~/.test.txt',
        destination: 'files/test.txt',
        hasChanges: true,
        repoContent: 'line 1\nline 2',
      };

      const output = formatUnifiedDiff(diff);

      expect(output).toContain('File missing on system');
      expect(output).toContain('Repository content:');
      expect(output).toContain('+ line 1');
      expect(output).toContain('+ line 2');
    });

    it('should format file not in repo correctly', async () => {
      const { formatUnifiedDiff } = await import('../../src/commands/diff.js');

      const diff: TestFileDiff = {
        source: '~/.test.txt',
        destination: 'files/test.txt',
        hasChanges: true,
        systemContent: 'line 1\nline 2',
      };

      const output = formatUnifiedDiff(diff);

      expect(output).toContain('File not yet synced to repository');
      expect(output).toContain('System content:');
      expect(output).toContain('- line 1');
      expect(output).toContain('- line 2');
    });

    it('should format line-by-line diff correctly', async () => {
      const { formatUnifiedDiff } = await import('../../src/commands/diff.js');

      const diff: TestFileDiff = {
        source: '~/.test.txt',
        destination: 'files/test.txt',
        hasChanges: true,
        systemContent: 'line 1\nline 2\nline 3\nline 4',
        repoContent: 'line 1\nmodified\nline 3\nline 4',
      };

      const output = formatUnifiedDiff(diff);

      expect(output).toContain('- line 2');
      expect(output).toContain('+ modified');
    });

    it('should format binary file diff correctly', async () => {
      const { formatUnifiedDiff } = await import('../../src/commands/diff.js');

      const diff: TestFileDiff = {
        source: '~/.test-binary',
        destination: 'files/test-binary',
        hasChanges: true,
        isBinary: true,
        systemSize: 100,
        repoSize: 200,
      };

      const output = formatUnifiedDiff(diff);

      expect(output).toContain('Binary files differ');
      expect(output).toContain('System:');
      expect(output).toContain('Repo:');
      expect(output).toContain('100 B');
      expect(output).toContain('200 B');
    });

    it('should format directory diff correctly', async () => {
      const { formatUnifiedDiff } = await import('../../src/commands/diff.js');

      const diff: TestFileDiff = {
        source: '~/.config/test',
        destination: 'files/test',
        hasChanges: true,
        isDirectory: true,
        fileCount: 5,
      };

      const output = formatUnifiedDiff(diff);

      expect(output).toContain('Directory content changed');
      expect(output).toContain('Contains 5 files');
    });
  });

  describe('computeDiffStats', () => {
    it('counts repo lines as insertions when system is missing', async () => {
      const { computeDiffStats } = await import('../../src/commands/diff.js');
      const stats = computeDiffStats({
        source: '~/.test.txt',
        destination: 'files/test.txt',
        hasChanges: true,
        repoContent: 'line 1\nline 2\nline 3',
      });
      expect(stats).toEqual({ insertions: 3, deletions: 0 });
    });

    it('counts system lines as deletions when repo is missing', async () => {
      const { computeDiffStats } = await import('../../src/commands/diff.js');
      const stats = computeDiffStats({
        source: '~/.test.txt',
        destination: 'files/test.txt',
        hasChanges: true,
        systemContent: 'line 1\nline 2',
      });
      expect(stats).toEqual({ insertions: 0, deletions: 2 });
    });

    it('pairs line-by-line when both sides exist', async () => {
      const { computeDiffStats } = await import('../../src/commands/diff.js');
      // system:  line 1 | line 2 | line 3 | line 4
      // repo:    line 1 | changed| line 3 | line 4
      // one differing index → +1 / -1
      const stats = computeDiffStats({
        source: '~/.test.txt',
        destination: 'files/test.txt',
        hasChanges: true,
        systemContent: 'line 1\nline 2\nline 3\nline 4',
        repoContent: 'line 1\nchanged\nline 3\nline 4',
      });
      expect(stats).toEqual({ insertions: 1, deletions: 1 });
    });

    it('counts trailing lines on the longer side without a pair', async () => {
      const { computeDiffStats } = await import('../../src/commands/diff.js');
      const stats = computeDiffStats({
        source: '~/.test.txt',
        destination: 'files/test.txt',
        hasChanges: true,
        systemContent: 'a\nb',
        repoContent: 'a\nb\nc\nd',
      });
      // indices 2, 3 on repo side have no system pair — 2 insertions, 0 deletions
      expect(stats).toEqual({ insertions: 2, deletions: 0 });
    });

    it('returns zeros for binary diffs', async () => {
      const { computeDiffStats } = await import('../../src/commands/diff.js');
      expect(
        computeDiffStats({
          source: '~/.bin',
          destination: 'files/bin',
          hasChanges: true,
          isBinary: true,
          systemSize: 100,
          repoSize: 200,
        })
      ).toEqual({ insertions: 0, deletions: 0 });
    });

    it('returns zeros for directory diffs', async () => {
      const { computeDiffStats } = await import('../../src/commands/diff.js');
      expect(
        computeDiffStats({
          source: '~/.config/test',
          destination: 'files/test',
          hasChanges: true,
          isDirectory: true,
          fileCount: 5,
        })
      ).toEqual({ insertions: 0, deletions: 0 });
    });
  });

  describe('formatStat', () => {
    const stripAnsi = (s: string): string =>
      // Strip ANSI escape sequences so assertions don't depend on color codes.
      // eslint-disable-next-line no-control-regex
      s.replace(/\[[0-9;]*m/g, '');

    it('renders a per-file line with pipe separator, count, and +/- bar', async () => {
      const { formatStat } = await import('../../src/commands/diff.js');
      const output = stripAnsi(
        formatStat([
          {
            source: '~/.zshrc',
            destination: 'files/shell/zshrc',
            hasChanges: true,
            systemContent: 'a\nb\nc',
            repoContent: 'a\nchanged\nc',
          },
        ])
      );
      expect(output).toMatch(/~\/\.zshrc\s+\|\s+2\s+\+-/);
    });

    it('labels binary files as Bin and directories as Dir', async () => {
      const { formatStat } = await import('../../src/commands/diff.js');
      const output = stripAnsi(
        formatStat([
          {
            source: '~/.bin',
            destination: 'files/bin',
            hasChanges: true,
            isBinary: true,
            systemSize: 100,
            repoSize: 200,
          },
          {
            source: '~/.config/app',
            destination: 'files/app',
            hasChanges: true,
            isDirectory: true,
            fileCount: 3,
          },
        ])
      );
      expect(output).toContain('| Bin');
      expect(output).toContain('| Dir (3 files)');
    });

    it('ends with a git-style footer summary', async () => {
      const { formatStat } = await import('../../src/commands/diff.js');
      const output = stripAnsi(
        formatStat([
          {
            source: '~/.a',
            destination: 'files/a',
            hasChanges: true,
            repoContent: 'new\nline',
          },
          {
            source: '~/.b',
            destination: 'files/b',
            hasChanges: true,
            systemContent: 'gone',
          },
        ])
      );
      // Pluralization: 2 files, 2 insertions, 1 deletion
      expect(output).toMatch(/2 files changed, 2 insertions\(\+\), 1 deletion\(-\)/);
    });

    it('singularizes file / insertion / deletion counts of 1', async () => {
      const { formatStat } = await import('../../src/commands/diff.js');
      const output = stripAnsi(
        formatStat([
          {
            source: '~/.a',
            destination: 'files/a',
            hasChanges: true,
            systemContent: 'a',
            repoContent: 'b',
          },
        ])
      );
      expect(output).toMatch(/1 file changed, 1 insertion\(\+\), 1 deletion\(-\)/);
    });
  });

  describe('FileDiff interface', () => {
    it('should have required fields', () => {
      const diff: TestFileDiff = {
        source: '~/.test.txt',
        destination: 'files/test.txt',
        hasChanges: true,
        systemContent: 'content',
        repoContent: 'content',
      };

      expect(diff.source).toBe('~/.test.txt');
      expect(diff.destination).toBe('files/test.txt');
      expect(diff.hasChanges).toBe(true);
      expect(diff.systemContent).toBe('content');
      expect(diff.repoContent).toBe('content');
    });

    it('should handle optional fields', () => {
      const diff: TestFileDiff = {
        source: '~/.test.txt',
        destination: 'files/test.txt',
        hasChanges: false,
      };

      expect(diff.source).toBeDefined();
      expect(diff.destination).toBeDefined();
      expect(diff.hasChanges).toBe(false);
      expect(diff.isBinary).toBeUndefined();
      expect(diff.isDirectory).toBeUndefined();
      expect(diff.fileCount).toBeUndefined();
    });
  });

  describe('manifest path safety', () => {
    it('rejects unsafe repository destination paths from manifest entries', async () => {
      const { runDiff } = await import('../../src/commands/diff.js');
      const manifest = createMockManifest();
      manifest.files['zshrc'] = createMockTrackedFile({
        source: '~/.zshrc',
        destination: 'files/../../outside',
      });
      vol.writeFileSync(join(TEST_TUCK_DIR, '.tuckmanifest.json'), JSON.stringify(manifest));

      await expect(runDiff([], {})).rejects.toThrow('Unsafe manifest destination');
    });
  });

  describe('host-group filtering', () => {
    // These tests verify the -g flag is accepted + `config.defaultGroups` is
    // honored as a fallback. We keep manifest entries safe and just confirm
    // the command runs without throwing under each scope combination — the
    // real filter plumbing is unit-tested in tests/lib/groupFilter.test.ts.
    const writeManifestWithGroups = (): void => {
      const manifest = createMockManifest();
      manifest.files['kali-rc'] = createMockTrackedFile({
        source: '~/.kali-rc',
        destination: 'files/shell/kali-rc',
        groups: ['kali'],
      });
      manifest.files['mac-rc'] = createMockTrackedFile({
        source: '~/.mac-rc',
        destination: 'files/shell/mac-rc',
        groups: ['work-mac'],
      });
      vol.writeFileSync(join(TEST_TUCK_DIR, '.tuckmanifest.json'), JSON.stringify(manifest));
    };

    it('accepts an explicit -g flag without throwing', async () => {
      writeManifestWithGroups();
      const { runDiff } = await import('../../src/commands/diff.js');
      await expect(runDiff([], { group: ['kali'] })).resolves.toBeUndefined();
    });

    it('honors config.defaultGroups from .tuckrc.local.json when -g is omitted', async () => {
      writeManifestWithGroups();
      vol.writeFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.local.json'),
        JSON.stringify({ defaultGroups: ['kali'] })
      );
      const { runDiff } = await import('../../src/commands/diff.js');
      await expect(runDiff([], {})).resolves.toBeUndefined();
    });

    it('does not filter explicit path arguments by group (user-intent override)', async () => {
      // Users invoking `tuck diff ~/.mac-rc` from a kali host deserve the
      // answer even though the file is tagged for another group. The filter
      // only gates the "all tracked files" sweep, not named paths.
      writeManifestWithGroups();
      vol.writeFileSync(
        join(TEST_TUCK_DIR, '.tuckrc.local.json'),
        JSON.stringify({ defaultGroups: ['kali'] })
      );
      const { runDiff } = await import('../../src/commands/diff.js');
      // Explicit path for a mac-tagged file — should not throw "not tracked"
      // and should not be filtered out by the kali scope.
      await expect(runDiff(['~/.mac-rc'], {})).resolves.toBeUndefined();
    });
  });
});
