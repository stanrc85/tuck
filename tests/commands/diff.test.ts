import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import chalk from 'chalk';
// Force ANSI output so render-integration assertions can verify that syntax
// tokens survive the diff pipeline. Production respects the terminal normally.
chalk.level = 2;
import { clearManifestCache } from '../../src/lib/manifest.js';
import { TEST_HOME, TEST_TUCK_DIR } from '../setup.js';
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
      message: vi.fn(),
    },
    note: vi.fn(),
    cancel: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      message: '',
    })),
  },
  formatCount: (n: number, singular: string, plural?: string) =>
    `${n} ${n === 1 ? singular : plural || `${singular}s`}`,
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

    it('applies syntax highlighting to content when the source is a known language', async () => {
      // Regression for the highlighter wiring — when the diff source resolves
      // to a supported language (shell here), tokens should be wrapped in
      // ANSI codes even inside the outer diff-color wrapper. We just confirm
      // SOME color codes appear on a token substring; specific color names
      // depend on the palette and shouldn't be pinned here.
      const { formatUnifiedDiff } = await import('../../src/commands/diff.js');
      const output = formatUnifiedDiff({
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
        hasChanges: true,
        systemContent: 'if [[ -z "$PATH" ]]; then echo empty; fi',
        repoContent: 'if [[ -z "$PATH" ]]; then echo filled; fi',
      });
      // The tokenised keyword `if` should be wrapped; we look for any SGR
      // sequence that starts inside one of the rendered lines.
      // eslint-disable-next-line no-control-regex
      expect(output).toMatch(/\x1b\[[0-9;]+m/);
    });

    it('skips highlighting for unknown file types (pass-through)', async () => {
      const { formatUnifiedDiff } = await import('../../src/commands/diff.js');
      const output = formatUnifiedDiff({
        source: '~/mystery.xyz',
        destination: 'files/mystery.xyz',
        hasChanges: true,
        systemContent: 'if then fi', // shell-ish keywords but not a shell file
        repoContent: 'if then done',
      });
      // Strip the outer diff colors and verify no inner token markers remain.
      // (An extra inner SGR would show up as a second \x1b[...m in a row.)
      // eslint-disable-next-line no-control-regex
      const withoutOuter = output.replace(/\x1b\[[0-9;]+m(if then fi|if then done)\x1b\[[0-9;]+m/g, '$1');
      // eslint-disable-next-line no-control-regex
      expect(withoutOuter).not.toMatch(/\x1b\[[0-9;]+mif\x1b/);
    });

    it('collapses long unchanged runs to a ruler instead of printing the whole file', async () => {
      // Regression for the pre-fix behavior where `inDiff` never reset once
      // set, so every line after the first change was printed as context. A
      // 15-line file with one edit at line 2 used to dump all 13 trailing
      // lines; the fix caps trailing context at DIFF_CONTEXT_LINES (3) and
      // collapses the rest to a ruler.
      const { formatUnifiedDiff } = await import('../../src/commands/diff.js');

      const systemLines = Array.from({ length: 15 }, (_, i) => `line ${i}`);
      const repoLines = [...systemLines];
      repoLines[1] = 'changed';

      const output = formatUnifiedDiff({
        source: '~/.big',
        destination: 'files/big',
        hasChanges: true,
        systemContent: systemLines.join('\n'),
        repoContent: repoLines.join('\n'),
      });

      expect(output).toContain('- line 1');
      expect(output).toContain('+ changed');
      expect(output).toMatch(/┄\s+\d+ unchanged lines\s+┄/);
      // Lines 8-14 are beyond the trailing context window — must not appear.
      expect(output).not.toContain('line 10');
      expect(output).not.toContain('line 14');
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

  describe('formatSideBySide', () => {
    const stripAnsi = (s: string): string =>
      // eslint-disable-next-line no-control-regex
      s.replace(/\x1b\[[0-9;]*m/g, '');

    const TERM = 120;

    it('emits a header row with both system and repository labels', async () => {
      const { formatSideBySide } = await import('../../src/commands/diff.js');
      const output = stripAnsi(
        formatSideBySide(
          {
            source: '~/.zshrc',
            destination: 'files/shell/zshrc',
            hasChanges: true,
            systemContent: 'a',
            repoContent: 'b',
          },
          TERM
        )
      );
      expect(output).toContain('--- a/~/.zshrc (system)');
      expect(output).toContain('+++ b/~/.zshrc (repository)');
    });

    it('uses `|` for modified, `+` for add-only, `-` for delete-only rows', async () => {
      const { formatSideBySide } = await import('../../src/commands/diff.js');
      const output = stripAnsi(
        formatSideBySide(
          {
            source: '~/.zshrc',
            destination: 'files/shell/zshrc',
            hasChanges: true,
            // system has 3 lines, repo has 4 — index 1 differs, index 3 repo-only
            systemContent: 'same\nsys-only\nmatch',
            repoContent: 'same\nrepo-ver\nmatch\nextra',
          },
          TERM
        )
      );
      // Modified row carries `|`
      expect(output).toMatch(/sys-only\s+\|\s+repo-ver/);
      // Repo-only row carries `+`
      expect(output).toMatch(/\+\s+extra/);
    });

    it('collapses unchanged runs longer than 2*context to a ruler', async () => {
      const { formatSideBySide } = await import('../../src/commands/diff.js');
      // 10 identical lines + 1 change at the end — the leading 10 should
      // collapse to a ruler (context = 3, so 10 > 0 + 3 → ruler with 7 skipped
      // + 3 context rows before the change).
      const same = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
      const output = stripAnsi(
        formatSideBySide(
          {
            source: '~/.big',
            destination: 'files/big',
            hasChanges: true,
            systemContent: same + '\nold',
            repoContent: same + '\nnew',
          },
          TERM
        )
      );
      expect(output).toMatch(/┄\s+7 unchanged lines\s+┄/);
      expect(output).toContain('old');
      expect(output).toContain('new');
      // The early unchanged lines (0–6) should NOT appear inline.
      expect(output).not.toMatch(/line 0\s/);
    });

    it('keeps unchanged runs short enough to sit within context inline', async () => {
      const { formatSideBySide } = await import('../../src/commands/diff.js');
      // 4 identical lines between two changes — context on each side = 3, so
      // run length 4 <= 3 + 3; no ruler should appear.
      const systemLines = ['start-sys', 'c1', 'c2', 'c3', 'c4', 'end-sys'];
      const repoLines = ['start-repo', 'c1', 'c2', 'c3', 'c4', 'end-repo'];
      const output = stripAnsi(
        formatSideBySide(
          {
            source: '~/.small',
            destination: 'files/small',
            hasChanges: true,
            systemContent: systemLines.join('\n'),
            repoContent: repoLines.join('\n'),
          },
          TERM
        )
      );
      expect(output).not.toContain('unchanged line');
      expect(output).toContain('c2');
    });

    it('truncates lines that overflow the column with an ellipsis', async () => {
      const { formatSideBySide } = await import('../../src/commands/diff.js');
      const longLine = 'x'.repeat(200);
      const output = stripAnsi(
        formatSideBySide(
          {
            source: '~/.long',
            destination: 'files/long',
            hasChanges: true,
            systemContent: longLine,
            repoContent: longLine + 'DIFFERENT',
          },
          TERM
        )
      );
      expect(output).toContain('…');
    });

    it('defers binary diffs to the unified renderer', async () => {
      const { formatSideBySide } = await import('../../src/commands/diff.js');
      const output = stripAnsi(
        formatSideBySide(
          {
            source: '~/.bin',
            destination: 'files/bin',
            hasChanges: true,
            isBinary: true,
            systemSize: 100,
            repoSize: 200,
          },
          TERM
        )
      );
      expect(output).toContain('Binary files differ');
      expect(output).not.toContain('|'); // no modified-row marker
    });

    it('defers directory diffs to the unified renderer', async () => {
      const { formatSideBySide } = await import('../../src/commands/diff.js');
      const output = stripAnsi(
        formatSideBySide(
          {
            source: '~/.config/app',
            destination: 'files/app',
            hasChanges: true,
            isDirectory: true,
            fileCount: 3,
          },
          TERM
        )
      );
      expect(output).toContain('Directory content changed');
    });

    it('defers one-sided diffs to the unified renderer', async () => {
      const { formatSideBySide } = await import('../../src/commands/diff.js');
      const output = stripAnsi(
        formatSideBySide(
          {
            source: '~/.newfile',
            destination: 'files/newfile',
            hasChanges: true,
            repoContent: 'only in repo',
          },
          TERM
        )
      );
      expect(output).toContain('File missing on system');
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

  describe('expandDirectoryDiff', () => {
    // Sub-file FileDiffs are what let every renderer and the syntax highlighter
    // work per-file without further plumbing. These tests exercise the walk
    // logic directly rather than through runDiff so failures point at the
    // primitive.
    const TRACKED_SOURCE = '~/.config/app';
    const TRACKED_DEST = 'files/config/app';
    const SYSTEM_DIR = `${TEST_HOME}/.config/app`;
    const REPO_DIR = `${TEST_TUCK_DIR}/${TRACKED_DEST}`;

    it('returns an empty list when both sides are missing', async () => {
      const { expandDirectoryDiff } = await import('../../src/commands/diff.js');
      const result = await expandDirectoryDiff(
        TRACKED_SOURCE,
        TRACKED_DEST,
        SYSTEM_DIR,
        REPO_DIR,
      );
      expect(result).toEqual([]);
    });

    it('emits one add diff per repo-only sub-file', async () => {
      const { expandDirectoryDiff } = await import('../../src/commands/diff.js');
      vol.mkdirSync(REPO_DIR, { recursive: true });
      vol.writeFileSync(`${REPO_DIR}/a.conf`, 'alpha\n');
      vol.writeFileSync(`${REPO_DIR}/b.conf`, 'beta\n');

      const result = await expandDirectoryDiff(
        TRACKED_SOURCE,
        TRACKED_DEST,
        null,
        REPO_DIR,
      );
      expect(result).toHaveLength(2);
      expect(result.map((d) => d.source).sort()).toEqual([
        '~/.config/app/a.conf',
        '~/.config/app/b.conf',
      ]);
      expect(result.every((d) => d.hasChanges && d.systemContent === undefined)).toBe(true);
      expect(result.find((d) => d.source === '~/.config/app/a.conf')?.repoContent).toBe(
        'alpha\n'
      );
    });

    it('emits one delete diff per system-only sub-file', async () => {
      const { expandDirectoryDiff } = await import('../../src/commands/diff.js');
      vol.mkdirSync(SYSTEM_DIR, { recursive: true });
      vol.writeFileSync(`${SYSTEM_DIR}/only.conf`, 'local\n');

      const result = await expandDirectoryDiff(
        TRACKED_SOURCE,
        TRACKED_DEST,
        SYSTEM_DIR,
        null,
      );
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('~/.config/app/only.conf');
      expect(result[0].hasChanges).toBe(true);
      expect(result[0].systemContent).toBe('local\n');
      expect(result[0].repoContent).toBeUndefined();
    });

    it('skips unchanged sub-files and surfaces only changed pairs', async () => {
      const { expandDirectoryDiff } = await import('../../src/commands/diff.js');
      vol.mkdirSync(SYSTEM_DIR, { recursive: true });
      vol.mkdirSync(REPO_DIR, { recursive: true });
      // Identical on both sides — should not appear.
      vol.writeFileSync(`${SYSTEM_DIR}/same.conf`, 'shared\n');
      vol.writeFileSync(`${REPO_DIR}/same.conf`, 'shared\n');
      // Differs — should appear.
      vol.writeFileSync(`${SYSTEM_DIR}/diff.conf`, 'sys\n');
      vol.writeFileSync(`${REPO_DIR}/diff.conf`, 'repo\n');

      const result = await expandDirectoryDiff(
        TRACKED_SOURCE,
        TRACKED_DEST,
        SYSTEM_DIR,
        REPO_DIR,
      );
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('~/.config/app/diff.conf');
      expect(result[0].systemContent).toBe('sys\n');
      expect(result[0].repoContent).toBe('repo\n');
    });

    it('attributes sub-file sources with the tracked-source prefix for nested paths', async () => {
      const { expandDirectoryDiff } = await import('../../src/commands/diff.js');
      vol.mkdirSync(`${REPO_DIR}/lua/plugins`, { recursive: true });
      vol.writeFileSync(`${REPO_DIR}/lua/plugins/lsp.lua`, 'return {}\n');

      const result = await expandDirectoryDiff(
        TRACKED_SOURCE,
        TRACKED_DEST,
        null,
        REPO_DIR,
      );
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('~/.config/app/lua/plugins/lsp.lua');
      expect(result[0].destination).toBe('files/config/app/lua/plugins/lsp.lua');
    });

    it('returns paired add + delete + change in one pass', async () => {
      const { expandDirectoryDiff } = await import('../../src/commands/diff.js');
      vol.mkdirSync(SYSTEM_DIR, { recursive: true });
      vol.mkdirSync(REPO_DIR, { recursive: true });
      // system-only — delete
      vol.writeFileSync(`${SYSTEM_DIR}/removed.conf`, 'bye\n');
      // repo-only — add
      vol.writeFileSync(`${REPO_DIR}/added.conf`, 'hi\n');
      // paired + different — modified
      vol.writeFileSync(`${SYSTEM_DIR}/changed.conf`, 'old\n');
      vol.writeFileSync(`${REPO_DIR}/changed.conf`, 'new\n');

      const result = await expandDirectoryDiff(
        TRACKED_SOURCE,
        TRACKED_DEST,
        SYSTEM_DIR,
        REPO_DIR,
      );
      expect(result).toHaveLength(3);
      const bySource = Object.fromEntries(result.map((d) => [d.source, d]));
      expect(bySource['~/.config/app/removed.conf'].systemContent).toBe('bye\n');
      expect(bySource['~/.config/app/removed.conf'].repoContent).toBeUndefined();
      expect(bySource['~/.config/app/added.conf'].repoContent).toBe('hi\n');
      expect(bySource['~/.config/app/added.conf'].systemContent).toBeUndefined();
      expect(bySource['~/.config/app/changed.conf'].systemContent).toBe('old\n');
      expect(bySource['~/.config/app/changed.conf'].repoContent).toBe('new\n');
    });
  });

  describe('directory expansion via runDiff', () => {
    // End-to-end verification that a tracked directory renders as per-file
    // sub-diffs with a cyan header instead of the old "Directory content
    // changed" collapse.
    const stripAnsi = (s: string): string =>
      // eslint-disable-next-line no-control-regex
      s.replace(/\x1b\[[0-9;]*m/g, '');

    const setupTrackedDirectory = (): void => {
      const manifest = createMockManifest();
      manifest.files['app'] = createMockTrackedFile({
        source: '~/.config/app',
        destination: 'files/config/app',
        category: 'misc',
      });
      vol.writeFileSync(
        join(TEST_TUCK_DIR, '.tuckmanifest.json'),
        JSON.stringify(manifest)
      );
      const systemDir = `${TEST_HOME}/.config/app`;
      const repoDir = `${TEST_TUCK_DIR}/files/config/app`;
      vol.mkdirSync(systemDir, { recursive: true });
      vol.mkdirSync(repoDir, { recursive: true });
      // Unchanged pair — must NOT appear in output.
      vol.writeFileSync(`${systemDir}/unchanged.conf`, 'same\n');
      vol.writeFileSync(`${repoDir}/unchanged.conf`, 'same\n');
      // Modified pair — must appear.
      vol.writeFileSync(`${systemDir}/modified.conf`, 'old\n');
      vol.writeFileSync(`${repoDir}/modified.conf`, 'new\n');
    };

    const captureConsole = (): { output: () => string; restore: () => void } => {
      const chunks: string[] = [];
      const original = console.log;
      // eslint-disable-next-line no-console
      console.log = (...args: unknown[]) => {
        chunks.push(args.map(String).join(' '));
      };
      return {
        output: () => stripAnsi(chunks.join('\n')),
        restore: () => {
          // eslint-disable-next-line no-console
          console.log = original;
        },
      };
    };

    it('prints a directory header + per-sub-file diff in full mode', async () => {
      setupTrackedDirectory();
      const { runDiff } = await import('../../src/commands/diff.js');
      const cap = captureConsole();
      try {
        await runDiff([], {});
      } finally {
        cap.restore();
      }
      const out = cap.output();
      expect(out).toContain('Directory ~/.config/app — 1 file changed');
      // Per-sub-file diff header uses the `--- a/<path> (system)` shape.
      expect(out).toContain('--- a/~/.config/app/modified.conf (system)');
      // The unchanged sub-file must not appear.
      expect(out).not.toContain('unchanged.conf');
      // The old collapsed line must be gone.
      expect(out).not.toContain('Directory content changed');
    });

    it('shows per-sub-file rows in --stat mode under the directory header', async () => {
      setupTrackedDirectory();
      const { runDiff } = await import('../../src/commands/diff.js');
      const cap = captureConsole();
      try {
        await runDiff([], { stat: true });
      } finally {
        cap.restore();
      }
      const out = cap.output();
      expect(out).toContain('Directory ~/.config/app — 1 file changed');
      // Per-sub-file row with the git-style bar pattern.
      expect(out).toMatch(/modified\.conf\s+\|\s+2\s+\+-/);
      // Footer aggregates sub-file totals across the directory.
      expect(out).toMatch(/1 file changed, 1 insertion\(\+\), 1 deletion\(-\)/);
    });

    it('lists each sub-file under the directory header in --name-only mode', async () => {
      setupTrackedDirectory();
      const { runDiff } = await import('../../src/commands/diff.js');
      const cap = captureConsole();
      try {
        await runDiff([], { nameOnly: true });
      } finally {
        cap.restore();
      }
      const out = cap.output();
      expect(out).toContain('Directory ~/.config/app — 1 file changed');
      expect(out).toContain('~/.config/app/modified.conf');
      expect(out).not.toContain('unchanged.conf');
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
