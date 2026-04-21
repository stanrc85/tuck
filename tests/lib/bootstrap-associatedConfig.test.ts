import { describe, it, expect } from 'vitest';
import {
  matchesAssociatedConfig,
  toolMatchesRestoredFiles,
} from '../../src/lib/bootstrap/associatedConfig.js';
import type { ToolDefinition } from '../../src/schemas/bootstrap.schema.js';
import { TEST_HOME } from '../setup.js';

const makeTool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id: 'test-tool',
  description: 'x',
  requires: [],
  install: 'true',
  detect: { paths: [], rcReferences: [] },
  associatedConfig: [],
  ...overrides,
});

describe('matchesAssociatedConfig', () => {
  it('matches anything under prefix/** including the prefix itself', () => {
    expect(matchesAssociatedConfig('~/.config/nvim/**', `${TEST_HOME}/.config/nvim`)).toBe(true);
    expect(
      matchesAssociatedConfig('~/.config/nvim/**', `${TEST_HOME}/.config/nvim/init.lua`)
    ).toBe(true);
    expect(
      matchesAssociatedConfig(
        '~/.config/nvim/**',
        `${TEST_HOME}/.config/nvim/lua/plugins/telescope.lua`
      )
    ).toBe(true);
  });

  it('prefix/** does NOT match a sibling path', () => {
    expect(
      matchesAssociatedConfig('~/.config/nvim/**', `${TEST_HOME}/.config/nvim-backup/init.lua`)
    ).toBe(false);
    expect(matchesAssociatedConfig('~/.config/nvim/**', `${TEST_HOME}/.config/yazi`)).toBe(false);
  });

  it('prefix/* matches direct children only (one level)', () => {
    expect(
      matchesAssociatedConfig('~/.config/fzf/*', `${TEST_HOME}/.config/fzf/themes.zsh`)
    ).toBe(true);
    expect(
      matchesAssociatedConfig('~/.config/fzf/*', `${TEST_HOME}/.config/fzf/sub/theme.zsh`)
    ).toBe(false);
    // Prefix itself is NOT a match for /* — single-star is children only.
    expect(matchesAssociatedConfig('~/.config/fzf/*', `${TEST_HOME}/.config/fzf`)).toBe(false);
  });

  it('literal paths require exact equality', () => {
    expect(
      matchesAssociatedConfig(
        '~/.config/nvim/lazy-lock.json',
        `${TEST_HOME}/.config/nvim/lazy-lock.json`
      )
    ).toBe(true);
    expect(
      matchesAssociatedConfig(
        '~/.config/nvim/lazy-lock.json',
        `${TEST_HOME}/.config/nvim/lazy-lock.json.bak`
      )
    ).toBe(false);
  });

  it('expands tilde in the candidate path too', () => {
    expect(matchesAssociatedConfig('~/.config/nvim/**', '~/.config/nvim/init.lua')).toBe(true);
  });
});

describe('toolMatchesRestoredFiles', () => {
  it('returns false when the tool has no associatedConfig', () => {
    const tool = makeTool();
    expect(toolMatchesRestoredFiles(tool, ['~/.config/nvim/init.lua'])).toBe(false);
  });

  it('returns true when any pattern matches any file', () => {
    const tool = makeTool({ associatedConfig: ['~/.config/nvim/**'] });
    expect(
      toolMatchesRestoredFiles(tool, [
        `${TEST_HOME}/.zshrc`,
        `${TEST_HOME}/.config/nvim/init.lua`,
      ])
    ).toBe(true);
  });

  it('returns false when no pattern matches any file', () => {
    const tool = makeTool({ associatedConfig: ['~/.config/nvim/**'] });
    expect(toolMatchesRestoredFiles(tool, [`${TEST_HOME}/.zshrc`])).toBe(false);
  });
});

describe('built-in zsh + zimfw associatedConfig coverage', () => {
  it('zsh matches canonical ~/.zshrc', async () => {
    const { zsh } = await import('../../src/lib/bootstrap/registry/zsh.js');
    expect(toolMatchesRestoredFiles(zsh, [`${TEST_HOME}/.zshrc`])).toBe(true);
  });

  it('zsh matches XDG-style ~/.config/zsh/.zshrc', async () => {
    const { zsh } = await import('../../src/lib/bootstrap/registry/zsh.js');
    expect(toolMatchesRestoredFiles(zsh, [`${TEST_HOME}/.config/zsh/.zshrc`])).toBe(true);
  });

  it('zsh matches nested ~/.config/zsh/aliases.zsh', async () => {
    const { zsh } = await import('../../src/lib/bootstrap/registry/zsh.js');
    expect(toolMatchesRestoredFiles(zsh, [`${TEST_HOME}/.config/zsh/aliases.zsh`])).toBe(true);
  });

  it('zsh matches ~/.zsh directory path', async () => {
    const { zsh } = await import('../../src/lib/bootstrap/registry/zsh.js');
    expect(toolMatchesRestoredFiles(zsh, [`${TEST_HOME}/.zsh`])).toBe(true);
  });

  it('zimfw matches canonical ~/.zimrc', async () => {
    const { zimfw } = await import('../../src/lib/bootstrap/registry/zimfw.js');
    expect(toolMatchesRestoredFiles(zimfw, [`${TEST_HOME}/.zimrc`])).toBe(true);
  });

  it('zimfw matches XDG-style ~/.config/zsh/.zimrc', async () => {
    const { zimfw } = await import('../../src/lib/bootstrap/registry/zimfw.js');
    expect(toolMatchesRestoredFiles(zimfw, [`${TEST_HOME}/.config/zsh/.zimrc`])).toBe(true);
  });
});
