import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { vol } from 'memfs';
import { join, dirname } from 'path';
import { readFileSync } from 'fs';
import { runCheatsheet } from '../../src/commands/cheatsheet.js';
import { clearManifestCache } from '../../src/lib/manifest.js';
import { clearConfigCache } from '../../src/lib/config.js';
import {
  createMockManifest,
  createMockTrackedFile,
} from '../utils/factories.js';
import { TEST_TUCK_DIR } from '../setup.js';

// Mock prompts/logger so the CLI run doesn't try to open stdin or render to TTY.
vi.mock('../../src/ui/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/ui/index.js')>(
    '../../src/ui/index.js'
  );
  return {
    ...actual,
    prompts: {
      ...actual.prompts,
      intro: vi.fn(),
      outro: vi.fn(),
      log: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    },
    logger: {
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    },
    isInteractive: vi.fn(() => true),
  };
});

const writeManifest = (manifest: ReturnType<typeof createMockManifest>): void => {
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

const seedWithTmuxAndZsh = (): void => {
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
  writeTrackedFile('files/shell/tmux.conf', 'bind r source-file ~/.tmux.conf  # reload\n');
  writeTrackedFile('files/shell/zshrc', "alias ll='ls -la'\n");
};

describe('tuck cheatsheet command', () => {
  beforeEach(() => {
    vol.reset();
    clearManifestCache();
    clearConfigCache();
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
  });

  afterEach(() => {
    vol.reset();
    clearManifestCache();
    clearConfigCache();
  });

  it('writes a markdown file to <tuckDir>/cheatsheet.md by default', async () => {
    seedWithTmuxAndZsh();

    const result = await runCheatsheet({});

    expect(result.path).toBe(join(TEST_TUCK_DIR, 'cheatsheet.md'));
    expect(result.totalEntries).toBe(2);

    const content = readFileSync(result.path!, 'utf-8');
    expect(content).toContain('# Dotfiles Cheatsheet');
    expect(content).toContain('## tmux');
    expect(content).toContain('## zsh');
    expect(content).toContain('`Prefix + r`');
    expect(content).toContain('`ll`');
  });

  it('honors -o/--output for a custom path', async () => {
    seedWithTmuxAndZsh();

    const out = '/tmp/custom-cheat.md';
    const result = await runCheatsheet({ output: out });

    expect(result.path).toBe(out);
    expect(readFileSync(out, 'utf-8')).toContain('# Dotfiles Cheatsheet');
  });

  it('does NOT write a file when --stdout is set', async () => {
    seedWithTmuxAndZsh();

    const result = await runCheatsheet({ stdout: true });
    expect(result.path).toBeNull();
    expect(result.totalEntries).toBe(2);
    // Nothing should land on disk
    expect(vol.existsSync(join(TEST_TUCK_DIR, 'cheatsheet.md'))).toBe(false);
  });

  it('filters via --sources', async () => {
    seedWithTmuxAndZsh();

    const result = await runCheatsheet({ sources: 'tmux' });

    const content = readFileSync(result.path!, 'utf-8');
    expect(content).toContain('## tmux');
    expect(content).not.toContain('## zsh');
    expect(result.totalEntries).toBe(1);
  });

  it('rejects unknown --sources values with a known-list hint', async () => {
    seedWithTmuxAndZsh();

    await expect(runCheatsheet({ sources: 'tmux,ghost' })).rejects.toThrow(
      /Unknown --sources value.*ghost.*Known parsers/
    );
  });

  it('writes an empty-state cheatsheet when no tracked files match any parser', async () => {
    writeManifest(
      createMockManifest({
        files: {
          random: createMockTrackedFile({
            source: '~/.random',
            destination: 'files/misc/random',
            category: 'misc',
            groups: ['default'],
          }),
        },
      })
    );
    writeTrackedFile('files/misc/random', 'not a keybind\n');

    const result = await runCheatsheet({});
    expect(result.totalEntries).toBe(0);
    const content = readFileSync(result.path!, 'utf-8');
    expect(content).toContain('No keybinds detected');
  });
});
