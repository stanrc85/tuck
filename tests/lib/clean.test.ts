import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { scanOrphans, deleteOrphans } from '../../src/lib/clean.js';
import { clearManifestCache } from '../../src/lib/manifest.js';
import { TEST_TUCK_DIR, TEST_FILES_DIR } from '../setup.js';
import { createMockManifest, createMockTrackedFile } from '../utils/factories.js';

const writeManifest = (
  files: Record<string, ReturnType<typeof createMockTrackedFile>>
): void => {
  const manifest = createMockManifest({ files });
  vol.writeFileSync(
    join(TEST_TUCK_DIR, '.tuckmanifest.json'),
    JSON.stringify(manifest)
  );
};

describe('scanOrphans', () => {
  beforeEach(() => {
    vol.reset();
    clearManifestCache();
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
    vol.mkdirSync(TEST_FILES_DIR, { recursive: true });
  });

  afterEach(() => {
    vol.reset();
    clearManifestCache();
  });

  it('returns an empty result when .tuck/files/ does not exist', async () => {
    vol.rmSync(TEST_FILES_DIR, { recursive: true });
    writeManifest({});

    const result = await scanOrphans(TEST_TUCK_DIR);

    expect(result.orphanFiles).toHaveLength(0);
    expect(result.orphanDirs).toHaveLength(0);
    expect(result.missingFromDisk).toHaveLength(0);
  });

  it('ignores tracked files that exist on disk', async () => {
    writeManifest({
      zshrc: createMockTrackedFile({
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
      }),
    });
    vol.mkdirSync(join(TEST_FILES_DIR, 'shell'), { recursive: true });
    vol.writeFileSync(join(TEST_FILES_DIR, 'shell/zshrc'), 'export PATH=...');

    const result = await scanOrphans(TEST_TUCK_DIR);

    expect(result.orphanFiles).toHaveLength(0);
    expect(result.missingFromDisk).toHaveLength(0);
  });

  it('flags files present in .tuck/files/ but not referenced by the manifest', async () => {
    writeManifest({
      zshrc: createMockTrackedFile({
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
      }),
    });
    vol.mkdirSync(join(TEST_FILES_DIR, 'shell'), { recursive: true });
    vol.writeFileSync(join(TEST_FILES_DIR, 'shell/zshrc'), 'tracked');
    vol.writeFileSync(join(TEST_FILES_DIR, 'shell/old-bashrc'), 'orphan content');

    const result = await scanOrphans(TEST_TUCK_DIR);

    expect(result.orphanFiles).toHaveLength(1);
    expect(result.orphanFiles[0].relativePath).toBe(join('files', 'shell', 'old-bashrc'));
    expect(result.orphanFiles[0].size).toBeGreaterThan(0);
    expect(result.totalSize).toBe(result.orphanFiles[0].size);
  });

  it('treats a tracked directory destination as fully tracked', async () => {
    writeManifest({
      nvim: createMockTrackedFile({
        source: '~/.config/nvim',
        destination: 'files/editors/config/nvim',
        category: 'editors',
      }),
    });
    vol.mkdirSync(join(TEST_FILES_DIR, 'editors/config/nvim/lua'), {
      recursive: true,
    });
    vol.writeFileSync(
      join(TEST_FILES_DIR, 'editors/config/nvim/init.lua'),
      'tracked'
    );
    vol.writeFileSync(
      join(TEST_FILES_DIR, 'editors/config/nvim/lua/plugins.lua'),
      'tracked'
    );

    const result = await scanOrphans(TEST_TUCK_DIR);

    expect(result.orphanFiles).toHaveLength(0);
    expect(result.orphanDirs).toHaveLength(0);
  });

  it('reports whole orphan subtrees as orphan dirs + files', async () => {
    writeManifest({
      zshrc: createMockTrackedFile({
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
      }),
    });
    vol.mkdirSync(join(TEST_FILES_DIR, 'shell'), { recursive: true });
    vol.writeFileSync(join(TEST_FILES_DIR, 'shell/zshrc'), 'tracked');

    // Whole 'stale' subtree is orphan
    vol.mkdirSync(join(TEST_FILES_DIR, 'stale/nested'), { recursive: true });
    vol.writeFileSync(join(TEST_FILES_DIR, 'stale/a.txt'), 'orphan');
    vol.writeFileSync(join(TEST_FILES_DIR, 'stale/nested/b.txt'), 'orphan');

    const result = await scanOrphans(TEST_TUCK_DIR);

    const relativePaths = result.orphanFiles.map((f) => f.relativePath).sort();
    expect(relativePaths).toEqual([
      join('files', 'stale', 'a.txt'),
      join('files', 'stale', 'nested', 'b.txt'),
    ]);
    expect(result.orphanDirs).toContain(join(TEST_FILES_DIR, 'stale'));
  });

  it('reports manifest entries whose destination is missing from disk', async () => {
    writeManifest({
      zshrc: createMockTrackedFile({
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
      }),
      gitconfig: createMockTrackedFile({
        source: '~/.gitconfig',
        destination: 'files/git/gitconfig',
        category: 'git',
      }),
    });
    vol.mkdirSync(join(TEST_FILES_DIR, 'shell'), { recursive: true });
    vol.writeFileSync(join(TEST_FILES_DIR, 'shell/zshrc'), 'tracked');
    // gitconfig intentionally missing from disk

    const result = await scanOrphans(TEST_TUCK_DIR);

    expect(result.missingFromDisk).toEqual([
      {
        id: 'gitconfig',
        source: '~/.gitconfig',
        destination: 'files/git/gitconfig',
      },
    ]);
  });
});

describe('deleteOrphans', () => {
  beforeEach(() => {
    vol.reset();
    clearManifestCache();
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
    vol.mkdirSync(TEST_FILES_DIR, { recursive: true });
  });

  afterEach(() => {
    vol.reset();
    clearManifestCache();
  });

  it('removes orphan files and empties their directories', async () => {
    writeManifest({
      zshrc: createMockTrackedFile({
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
      }),
    });
    vol.mkdirSync(join(TEST_FILES_DIR, 'shell'), { recursive: true });
    vol.writeFileSync(join(TEST_FILES_DIR, 'shell/zshrc'), 'tracked');
    vol.mkdirSync(join(TEST_FILES_DIR, 'stale/nested'), { recursive: true });
    vol.writeFileSync(join(TEST_FILES_DIR, 'stale/a.txt'), 'orphan');
    vol.writeFileSync(join(TEST_FILES_DIR, 'stale/nested/b.txt'), 'orphan');

    const result = await scanOrphans(TEST_TUCK_DIR);
    await deleteOrphans(result);

    expect(vol.existsSync(join(TEST_FILES_DIR, 'stale'))).toBe(false);
    expect(vol.existsSync(join(TEST_FILES_DIR, 'shell/zshrc'))).toBe(true);
  });

  it('is a no-op when there are no orphans', async () => {
    writeManifest({
      zshrc: createMockTrackedFile({
        source: '~/.zshrc',
        destination: 'files/shell/zshrc',
      }),
    });
    vol.mkdirSync(join(TEST_FILES_DIR, 'shell'), { recursive: true });
    vol.writeFileSync(join(TEST_FILES_DIR, 'shell/zshrc'), 'tracked');

    const result = await scanOrphans(TEST_TUCK_DIR);
    await deleteOrphans(result);

    expect(vol.existsSync(join(TEST_FILES_DIR, 'shell/zshrc'))).toBe(true);
  });
});
