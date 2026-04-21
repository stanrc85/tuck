import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { join, dirname } from 'path';
import { generateCheatsheet } from '../../src/lib/cheatsheet/index.js';
import { NotInitializedError } from '../../src/errors.js';
import { clearManifestCache } from '../../src/lib/manifest.js';
import {
  createMockManifest,
  createMockTrackedFile,
} from '../utils/factories.js';
import { TEST_TUCK_DIR } from '../setup.js';

const writeManifest = (
  manifest: ReturnType<typeof createMockManifest>
): void => {
  vol.writeFileSync(
    join(TEST_TUCK_DIR, '.tuckmanifest.json'),
    JSON.stringify(manifest)
  );
};

const writeTrackedFile = (relPath: string, content: string): void => {
  const full = join(TEST_TUCK_DIR, relPath);
  vol.mkdirSync(dirname(full), { recursive: true });
  vol.writeFileSync(full, content);
};

describe('generateCheatsheet', () => {
  beforeEach(() => {
    vol.reset();
    clearManifestCache();
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
  });

  afterEach(() => {
    vol.reset();
    clearManifestCache();
  });

  it('throws NotInitializedError when manifest is missing', async () => {
    await expect(generateCheatsheet(TEST_TUCK_DIR)).rejects.toBeInstanceOf(NotInitializedError);
  });

  it('collects entries across tmux + zsh + yazi parsers', async () => {
    writeManifest(
      createMockManifest({
        files: {
          tmux: createMockTrackedFile({
            source: '~/.tmux.conf',
            destination: 'files/shell/tmux.conf',
            groups: ['default'],
          }),
          zshrc: createMockTrackedFile({
            source: '~/.zshrc',
            destination: 'files/shell/zshrc',
            groups: ['default'],
          }),
          yazi: createMockTrackedFile({
            source: '~/.config/yazi/keymap.toml',
            destination: 'files/yazi/keymap.toml',
            category: 'config',
            groups: ['default'],
          }),
        },
      })
    );
    writeTrackedFile(
      'files/shell/tmux.conf',
      'bind r source-file ~/.tmux.conf  # reload\n'
    );
    writeTrackedFile(
      'files/shell/zshrc',
      "alias ll='ls -la'\nbindkey '^R' history-search\n"
    );
    writeTrackedFile(
      'files/yazi/keymap.toml',
      `[[keymap.manager.keymap]]\non = ['x']\nrun = 'delete'\ndesc = 'Delete'\n`
    );

    const result = await generateCheatsheet(TEST_TUCK_DIR);

    expect(result.totalEntries).toBe(4); // 1 tmux + 2 zsh + 1 yazi
    expect(result.sections.map((s) => s.parserId).sort()).toEqual(['tmux', 'yazi', 'zsh']);
    // neovim-lua produces no entries because the fixture has no nvim files.
    expect(result.skippedParsers).toEqual(['neovim-lua']);
  });

  it('honors the --sources filter', async () => {
    writeManifest(
      createMockManifest({
        files: {
          tmux: createMockTrackedFile({
            source: '~/.tmux.conf',
            destination: 'files/shell/tmux.conf',
            groups: ['default'],
          }),
          zshrc: createMockTrackedFile({
            source: '~/.zshrc',
            destination: 'files/shell/zshrc',
            groups: ['default'],
          }),
        },
      })
    );
    writeTrackedFile('files/shell/tmux.conf', 'bind r source-file ~/.tmux.conf\n');
    writeTrackedFile('files/shell/zshrc', "alias ll='ls -la'\n");

    const result = await generateCheatsheet(TEST_TUCK_DIR, { sources: ['tmux'] });

    expect(result.sections.map((s) => s.parserId)).toEqual(['tmux']);
    expect(result.totalEntries).toBe(1);
  });

  it('honors the host-group filter', async () => {
    writeManifest(
      createMockManifest({
        files: {
          tmux: createMockTrackedFile({
            source: '~/.tmux.conf',
            destination: 'files/shell/tmux.conf',
            groups: ['kubuntu'],
          }),
          zshrc: createMockTrackedFile({
            source: '~/.zshrc',
            destination: 'files/shell/zshrc',
            groups: ['kali'],
          }),
        },
      })
    );
    writeTrackedFile('files/shell/tmux.conf', 'bind r source-file ~/.tmux.conf\n');
    writeTrackedFile('files/shell/zshrc', "alias ll='ls -la'\n");

    const result = await generateCheatsheet(TEST_TUCK_DIR, { filterGroups: ['kali'] });

    // Only the zshrc matches the kali group — tmux is kubuntu-only.
    expect(result.sections.map((s) => s.parserId)).toEqual(['zsh']);
    expect(result.totalEntries).toBe(1);
  });

  it('returns empty when no tracked files match any parser', async () => {
    writeManifest(
      createMockManifest({
        files: {
          other: createMockTrackedFile({
            source: '~/.random.conf',
            destination: 'files/misc/random.conf',
            category: 'misc',
            groups: ['default'],
          }),
        },
      })
    );
    writeTrackedFile('files/misc/random.conf', 'nothing useful here\n');

    const result = await generateCheatsheet(TEST_TUCK_DIR);
    expect(result.totalEntries).toBe(0);
    expect(result.sections).toEqual([]);
    expect(result.skippedParsers.length).toBeGreaterThan(0);
  });

  it('skips files whose source is missing from the repo without crashing', async () => {
    writeManifest(
      createMockManifest({
        files: {
          tmux: createMockTrackedFile({
            source: '~/.tmux.conf',
            destination: 'files/shell/tmux.conf',
            groups: ['default'],
          }),
        },
      })
    );
    // Deliberately don't write the source file. Should not throw.
    const result = await generateCheatsheet(TEST_TUCK_DIR);
    expect(result.totalEntries).toBe(0);
  });

  it('walks into tracked directories and feeds each file to the parsers', async () => {
    // Simulates the common case where a user tracks `~/.config/nvim/` or
    // `~/.config/yazi/` as a whole directory instead of individual files.
    // The manifest has ONE entry (the directory), but we need to recurse
    // into it so per-file parsers still match. Regression for the
    // "no entries captured from dir-tracked configs" bug.
    writeManifest(
      createMockManifest({
        files: {
          nvim: createMockTrackedFile({
            source: '~/.config/nvim',
            destination: 'files/editors/nvim',
            category: 'editors',
            groups: ['default'],
          }),
          yazi: createMockTrackedFile({
            source: '~/.config/yazi',
            destination: 'files/config/yazi',
            category: 'config',
            groups: ['default'],
          }),
        },
      })
    );
    writeTrackedFile(
      'files/editors/nvim/init.lua',
      `vim.keymap.set('n', '<leader>ff', 'telescope', { desc = 'Find files' })\n`
    );
    writeTrackedFile(
      'files/editors/nvim/lua/plugins/telescope.lua',
      `vim.keymap.set('n', '<leader>fg', 'live_grep', { desc = 'Grep' })\n`
    );
    writeTrackedFile(
      'files/config/yazi/keymap.toml',
      `[[keymap.manager.keymap]]\non = ['x']\nrun = 'delete'\ndesc = 'Delete'\n`
    );
    // Non-matching file in the same tracked dir — should be ignored silently.
    writeTrackedFile('files/config/yazi/theme.toml', '[manager]\nbg = "dark"\n');

    const result = await generateCheatsheet(TEST_TUCK_DIR);

    const byId = Object.fromEntries(result.sections.map((s) => [s.parserId, s]));
    expect(byId['neovim-lua']?.entries).toHaveLength(2);
    expect(byId['yazi']?.entries).toHaveLength(1);

    // Virtual source paths reflect the real file location, not the
    // tracked-dir root — so the renderer can point users at the exact file.
    const nvimSources = byId['neovim-lua']!.entries.map((e) => e.sourceFile).sort();
    expect(nvimSources).toEqual([
      '~/.config/nvim/init.lua',
      '~/.config/nvim/lua/plugins/telescope.lua',
    ]);
    expect(byId['yazi']!.entries[0].sourceFile).toBe('~/.config/yazi/keymap.toml');
  });
});
