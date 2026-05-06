import { describe, it, expect, beforeEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { pruneOrphansForRestore } from '../../src/lib/files.js';
import { TEST_HOME } from '../setup.js';

const SOURCE = join(TEST_HOME, '.tuck/files/cli/.config/nvim');
const DEST = join(TEST_HOME, '.config/nvim');

describe('pruneOrphansForRestore', () => {
  beforeEach(() => {
    vol.mkdirSync(SOURCE, { recursive: true });
    vol.mkdirSync(DEST, { recursive: true });
  });

  it('removes a dest file that no longer exists in source', async () => {
    vol.writeFileSync(join(SOURCE, 'init.lua'), '-- live');
    vol.writeFileSync(join(DEST, 'init.lua'), '-- live');
    vol.writeFileSync(join(DEST, 'old-plugin.lua'), '-- stale');

    const result = await pruneOrphansForRestore(SOURCE, DEST, new Set());

    expect(result.pruned).toEqual(['~/.config/nvim/old-plugin.lua']);
    expect(result.exempted).toEqual([]);
    expect(vol.existsSync(join(DEST, 'old-plugin.lua'))).toBe(false);
    expect(vol.existsSync(join(DEST, 'init.lua'))).toBe(true);
  });

  it('descends into matching subdirs and prunes orphans there', async () => {
    vol.mkdirSync(join(SOURCE, 'lua/plugins'), { recursive: true });
    vol.mkdirSync(join(DEST, 'lua/plugins'), { recursive: true });
    vol.writeFileSync(join(SOURCE, 'lua/plugins/core.lua'), '-- live');
    vol.writeFileSync(join(DEST, 'lua/plugins/core.lua'), '-- live');
    vol.writeFileSync(join(DEST, 'lua/plugins/dead.lua'), '-- stale');

    const result = await pruneOrphansForRestore(SOURCE, DEST, new Set());

    expect(result.pruned).toEqual(['~/.config/nvim/lua/plugins/dead.lua']);
    expect(vol.existsSync(join(DEST, 'lua/plugins/dead.lua'))).toBe(false);
    expect(vol.existsSync(join(DEST, 'lua/plugins/core.lua'))).toBe(true);
  });

  it('prunes an entire dest subdir when source has no matching dir', async () => {
    vol.mkdirSync(join(DEST, 'lua/dead-suite'), { recursive: true });
    vol.writeFileSync(join(DEST, 'lua/dead-suite/a.lua'), '');
    vol.writeFileSync(join(DEST, 'lua/dead-suite/b.lua'), '');
    vol.mkdirSync(join(SOURCE, 'lua'), { recursive: true });

    const result = await pruneOrphansForRestore(SOURCE, DEST, new Set());

    expect(result.pruned).toEqual(['~/.config/nvim/lua/dead-suite']);
    expect(vol.existsSync(join(DEST, 'lua/dead-suite'))).toBe(false);
  });

  it('exempts a file matching .tuckignore exactly', async () => {
    vol.writeFileSync(join(DEST, 'private-scratch.lua'), '-- host-local');

    const tuckIgnore = new Set(['~/.config/nvim/private-scratch.lua']);
    const result = await pruneOrphansForRestore(SOURCE, DEST, tuckIgnore);

    expect(result.pruned).toEqual([]);
    expect(result.exempted).toEqual(['~/.config/nvim/private-scratch.lua']);
    expect(vol.existsSync(join(DEST, 'private-scratch.lua'))).toBe(true);
  });

  it('exempts every entry under a directory listed in .tuckignore', async () => {
    vol.mkdirSync(join(DEST, 'lua/private'), { recursive: true });
    vol.writeFileSync(join(DEST, 'lua/private/work.lua'), '');
    vol.writeFileSync(join(DEST, 'lua/private/secrets.lua'), '');
    vol.mkdirSync(join(SOURCE, 'lua'), { recursive: true });

    const tuckIgnore = new Set(['~/.config/nvim/lua/private']);
    const result = await pruneOrphansForRestore(SOURCE, DEST, tuckIgnore);

    expect(result.pruned).toEqual([]);
    expect(result.exempted).toEqual(['~/.config/nvim/lua/private']);
    expect(vol.existsSync(join(DEST, 'lua/private/work.lua'))).toBe(true);
    expect(vol.existsSync(join(DEST, 'lua/private/secrets.lua'))).toBe(true);
  });

  it('skips .git, node_modules, .DS_Store and other copy-skipped names', async () => {
    vol.mkdirSync(join(DEST, '.git/objects'), { recursive: true });
    vol.writeFileSync(join(DEST, '.git/HEAD'), 'ref: refs/heads/main');
    vol.writeFileSync(join(DEST, '.DS_Store'), 'macos');
    vol.mkdirSync(join(DEST, 'node_modules/foo'), { recursive: true });
    vol.writeFileSync(join(DEST, 'node_modules/foo/index.js'), '');

    const result = await pruneOrphansForRestore(SOURCE, DEST, new Set());

    expect(result.pruned).toEqual([]);
    expect(vol.existsSync(join(DEST, '.git/HEAD'))).toBe(true);
    expect(vol.existsSync(join(DEST, '.DS_Store'))).toBe(true);
    expect(vol.existsSync(join(DEST, 'node_modules/foo/index.js'))).toBe(true);
  });

  it('dryRun reports the prune set without removing anything', async () => {
    vol.writeFileSync(join(DEST, 'old-plugin.lua'), '-- stale');

    const result = await pruneOrphansForRestore(SOURCE, DEST, new Set(), { dryRun: true });

    expect(result.pruned).toEqual(['~/.config/nvim/old-plugin.lua']);
    expect(vol.existsSync(join(DEST, 'old-plugin.lua'))).toBe(true);
  });

  it('returns empty result when source is a file (not a directory)', async () => {
    vol.rmSync(SOURCE, { recursive: true });
    vol.writeFileSync(SOURCE, 'just a file');

    const result = await pruneOrphansForRestore(SOURCE, DEST, new Set());

    expect(result.pruned).toEqual([]);
    expect(result.exempted).toEqual([]);
  });

  it('returns empty result when dest does not exist', async () => {
    vol.rmSync(DEST, { recursive: true });

    const result = await pruneOrphansForRestore(SOURCE, DEST, new Set());

    expect(result.pruned).toEqual([]);
    expect(result.exempted).toEqual([]);
  });

  it('does not descend when source has a file at a path where dest has a dir (type-flip)', async () => {
    // Source: file at lua/plugins. Dest: dir at lua/plugins with a child.
    // copyFileOrDir's overwrite handles the type-flip; pruner must not
    // recurse into the dest dir or it would flag the child as orphan.
    vol.mkdirSync(join(SOURCE, 'lua'), { recursive: true });
    vol.writeFileSync(join(SOURCE, 'lua/plugins'), '-- now a file');
    vol.mkdirSync(join(DEST, 'lua/plugins'), { recursive: true });
    vol.writeFileSync(join(DEST, 'lua/plugins/a.lua'), '');

    const result = await pruneOrphansForRestore(SOURCE, DEST, new Set());

    expect(result.pruned).toEqual([]);
    expect(vol.existsSync(join(DEST, 'lua/plugins/a.lua'))).toBe(true);
  });
});
