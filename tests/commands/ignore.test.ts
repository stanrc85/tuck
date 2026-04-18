import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { ignoreCommand } from '../../src/commands/ignore.js';
import { clearManifestCache } from '../../src/lib/manifest.js';
import { loadTuckignore, getIgnoredPaths } from '../../src/lib/tuckignore.js';
import { TEST_TUCK_DIR } from '../setup.js';
import { createMockManifest, createMockTrackedFile } from '../utils/factories.js';

const writeManifest = (files: Record<string, ReturnType<typeof createMockTrackedFile>> = {}): void => {
  const manifest = createMockManifest({ files });
  vol.writeFileSync(join(TEST_TUCK_DIR, '.tuckmanifest.json'), JSON.stringify(manifest));
};

const run = async (...args: string[]): Promise<void> => {
  // Default 'node' mode strips argv[0..1], so commander routes to subcommands.
  await ignoreCommand.parseAsync(['node', 'ignore', ...args]);
};

describe('tuck ignore', () => {
  beforeEach(() => {
    vol.reset();
    clearManifestCache();
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
    writeManifest();
  });

  afterEach(() => {
    vol.reset();
    clearManifestCache();
  });

  describe('add', () => {
    it('appends a new path to .tuckignore', async () => {
      await run('add', '~/.cache');

      const ignored = await loadTuckignore(TEST_TUCK_DIR);
      expect(ignored.has('~/.cache')).toBe(true);
    });

    it('normalizes absolute paths under HOME to ~/...', async () => {
      await run('add', '/test-home/.local/share/nvim');

      const paths = await getIgnoredPaths(TEST_TUCK_DIR);
      expect(paths).toContain('~/.local/share/nvim');
    });

    it('skips duplicates without error', async () => {
      await run('add', '~/.cache');
      await run('add', '~/.cache');

      const paths = await getIgnoredPaths(TEST_TUCK_DIR);
      expect(paths.filter((p) => p === '~/.cache')).toHaveLength(1);
    });

    it('skips currently-tracked paths unless --force is passed', async () => {
      writeManifest({
        zshrc: createMockTrackedFile({ source: '~/.zshrc', destination: 'files/shell/zshrc' }),
      });

      await run('add', '~/.zshrc');

      const paths = await getIgnoredPaths(TEST_TUCK_DIR);
      expect(paths).not.toContain('~/.zshrc');
    });

    it('ignores tracked paths with --force', async () => {
      writeManifest({
        zshrc: createMockTrackedFile({ source: '~/.zshrc', destination: 'files/shell/zshrc' }),
      });

      await run('add', '--force', '~/.zshrc');

      const paths = await getIgnoredPaths(TEST_TUCK_DIR);
      expect(paths).toContain('~/.zshrc');
    });
  });

  describe('rm', () => {
    it('removes a path from .tuckignore', async () => {
      await run('add', '~/.cache');
      await run('rm', '~/.cache');

      const paths = await getIgnoredPaths(TEST_TUCK_DIR);
      expect(paths).not.toContain('~/.cache');
    });

    it('is a no-op when the path is not ignored', async () => {
      await run('rm', '~/.nothing-here');

      const paths = await getIgnoredPaths(TEST_TUCK_DIR);
      expect(paths).toHaveLength(0);
    });
  });

  describe('list', () => {
    it('prints ignored paths', async () => {
      await run('add', '~/.cache');
      await run('add', '~/.local/share/nvim');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await run('list');
      const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      logSpy.mockRestore();

      expect(output).toContain('~/.cache');
      expect(output).toContain('~/.local/share/nvim');
    });
  });

  describe('initialization guard', () => {
    it('throws NotInitializedError when tuck is not initialized', async () => {
      vol.reset();
      clearManifestCache();
      vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
      // No manifest written

      await expect(run('list')).rejects.toMatchObject({ code: 'NOT_INITIALIZED' });
    });
  });
});
