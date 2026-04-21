import { describe, it, expect } from 'vitest';
import { tmuxParser } from '../../src/lib/cheatsheet/parsers/tmux.js';
import { zshParser } from '../../src/lib/cheatsheet/parsers/zsh.js';
import { yaziParser } from '../../src/lib/cheatsheet/parsers/yazi.js';

const ctx = (path: string) => ({ sourceFile: path });

describe('tmux parser', () => {
  it('matches the standard tmux config paths', () => {
    expect(tmuxParser.match('~/.tmux.conf', '')).toBe(true);
    expect(tmuxParser.match('~/.config/tmux/tmux.conf', '')).toBe(true);
    expect(tmuxParser.match('~/.zshrc', '')).toBe(false);
  });

  it('extracts bind-key lines with trailing comments as action descriptions', () => {
    const content = [
      '# tmux config',
      '',
      'bind-key r source-file ~/.tmux.conf \\; display "Reloaded!"',
      'bind -r h select-pane -L  # navigate left',
      'bind -n M-Left previous-window',
      'unbind C-b',
      'set -g prefix C-a',
    ].join('\n');

    const entries = tmuxParser.parse(content, ctx('~/.tmux.conf'));

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      keybind: 'Prefix + r',
      action: expect.stringContaining('source-file'),
      sourceLine: 3,
    });
    expect(entries[1]).toMatchObject({
      keybind: 'Prefix + h',
      action: 'navigate left',
      sourceLine: 4,
    });
    expect(entries[2]).toMatchObject({
      keybind: 'Prefix + M-Left',
      action: 'previous-window',
      sourceLine: 5,
    });
  });

  it('ignores comment-only lines and `unbind`', () => {
    const entries = tmuxParser.parse('# just a comment\nunbind C-b\n', ctx('~/.tmux.conf'));
    expect(entries).toEqual([]);
  });

  it('handles `-T <table>` flag correctly', () => {
    const entries = tmuxParser.parse(
      'bind -T copy-mode-vi v send -X begin-selection',
      ctx('~/.tmux.conf')
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].keybind).toBe('Prefix + v');
    expect(entries[0].action).toContain('begin-selection');
  });
});

describe('zsh parser', () => {
  it('matches .zshrc and files under ~/.config/zsh/', () => {
    expect(zshParser.match('~/.zshrc', '')).toBe(true);
    expect(zshParser.match('~/.config/zsh/aliases.zsh', '')).toBe(true);
    expect(zshParser.match('~/.tmux.conf', '')).toBe(false);
  });

  it('extracts bindkey entries', () => {
    const content = [
      "bindkey '^R' history-incremental-search-backward",
      'bindkey "^[[A" up-line-or-history',
      'bindkey -e  # emacs mode — not a binding',
      'bindkey -M vicmd "k" up-line-or-history',
    ].join('\n');

    const entries = zshParser.parse(content, ctx('~/.zshrc'));
    expect(entries.map((e) => e.keybind)).toEqual(['^R', '^[[A', 'k']);
    expect(entries[2].action).toBe('up-line-or-history');
  });

  it('extracts alias entries with category="alias"', () => {
    const content = [
      "alias ll='ls -la'",
      'alias g=git',
      "alias -g ...G='| grep'",
    ].join('\n');

    const entries = zshParser.parse(content, ctx('~/.zshrc'));
    expect(entries.map((e) => e.keybind).sort()).toEqual(['...G', 'g', 'll']);
    entries.forEach((e) => expect(e.category).toBe('alias'));
  });

  it('skips comment-only lines', () => {
    const entries = zshParser.parse(
      '# bindkey "^X" echo  (this should NOT be captured)\n',
      ctx('~/.zshrc')
    );
    expect(entries).toEqual([]);
  });

  it('returns empty when bindkey is mode-switch-only', () => {
    expect(zshParser.parse('bindkey -e\n', ctx('~/.zshrc'))).toEqual([]);
    expect(zshParser.parse('bindkey -v\n', ctx('~/.zshrc'))).toEqual([]);
  });
});

describe('yazi parser', () => {
  it('matches only keymap.toml under a yazi directory', () => {
    expect(yaziParser.match('~/.config/yazi/keymap.toml', '')).toBe(true);
    expect(yaziParser.match('~/.config/yazi/theme.toml', '')).toBe(false);
    expect(yaziParser.match('~/.config/other/keymap.toml', '')).toBe(false);
  });

  it('extracts keymap entries across modes', () => {
    const content = `
[[keymap.manager.prepend_keymap]]
on  = ['r']
run = 'reload'
desc = 'Reload'

[[keymap.manager.keymap]]
on  = ['g', 'h']
run = 'cd ~'

[[keymap.input.prepend_keymap]]
on  = ['<Esc>']
run = 'escape'
desc = 'Exit input'
`;
    const entries = yaziParser.parse(content, ctx('~/.config/yazi/keymap.toml'));

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      keybind: 'r',
      action: 'Reload',
      category: 'manager',
    });
    expect(entries[1]).toMatchObject({
      keybind: 'g then h',
      action: 'cd ~',
      category: 'manager',
    });
    expect(entries[2]).toMatchObject({
      keybind: '<Esc>',
      action: 'Exit input',
      category: 'input',
    });
  });

  it('returns empty on malformed TOML instead of throwing', () => {
    expect(yaziParser.parse('[[[invalid', ctx('~/.config/yazi/keymap.toml'))).toEqual([]);
  });

  it('falls back to run command when desc is absent', () => {
    const content = `[[keymap.manager.keymap]]
on = ['x']
run = 'delete'`;
    const entries = yaziParser.parse(content, ctx('~/.config/yazi/keymap.toml'));
    expect(entries[0].action).toBe('delete');
  });
});
