import { describe, it, expect } from 'vitest';
import { tmuxParser } from '../../src/lib/cheatsheet/parsers/tmux.js';
import { zshParser } from '../../src/lib/cheatsheet/parsers/zsh.js';
import { yaziParser } from '../../src/lib/cheatsheet/parsers/yazi.js';
import { neovimLuaParser } from '../../src/lib/cheatsheet/parsers/neovim-lua.js';

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

  it('accepts `##` (multi-hash) trailing comments as action descriptions', () => {
    const entries = tmuxParser.parse(
      'bind -r h select-pane -L  ## navigate left\nbind -r l select-pane -R   ### navigate right',
      ctx('~/.tmux.conf')
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe('navigate left');
    expect(entries[1].action).toBe('navigate right');
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

  it('promotes trailing `#`/`##` comments on bindkey lines to the action', () => {
    const content = [
      '# --- CURSOR MOVEMENT ---',
      "bindkey '^a' beginning-of-line      ## Move to start of line",
      "bindkey '^e' end-of-line            ## Move to end of line",
      "bindkey '^f' forward-char           # Move forward one char",
      "bindkey '^b' backward-char",
    ].join('\n');

    const entries = zshParser.parse(content, ctx('~/.zshrc'));

    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ keybind: '^a', action: 'Move to start of line' });
    expect(entries[1]).toMatchObject({ keybind: '^e', action: 'Move to end of line' });
    expect(entries[2]).toMatchObject({ keybind: '^f', action: 'Move forward one char' });
    // No trailing comment -> falls back to widget name.
    expect(entries[3]).toMatchObject({ keybind: '^b', action: 'backward-char' });
  });

  it('promotes trailing comments on alias lines to the action', () => {
    const content = [
      "alias ll='ls -la'   ## long listing",
      "alias gs='git status'  # show working tree",
      "alias g=git",
    ].join('\n');

    const entries = zshParser.parse(content, ctx('~/.zshrc'));

    expect(entries[0]).toMatchObject({ keybind: 'll', action: 'long listing', category: 'alias' });
    expect(entries[1]).toMatchObject({ keybind: 'gs', action: 'show working tree', category: 'alias' });
    // No trailing comment -> falls back to alias value.
    expect(entries[2]).toMatchObject({ keybind: 'g', action: 'git', category: 'alias' });
  });

  it('does not split on `#` embedded in a quoted alias body', () => {
    const entries = zshParser.parse(
      "alias findhash='grep -rn \"#TODO\"'\n",
      ctx('~/.zshrc')
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      keybind: 'findhash',
      action: 'grep -rn "#TODO"',
    });
  });

  it('captures `# --- SECTION ---` headers and attaches them to subsequent entries', () => {
    const content = [
      'bindkey -e',
      "bindkey '^z' undo               ## Undo",
      '',
      '# --- CURSOR MOVEMENT ---',
      "bindkey '^a' beginning-of-line  ## Move to start",
      "bindkey '^e' end-of-line        ## Move to end",
      '',
      '## === GIT ALIASES ===',
      "alias gs='git status'           ## status",
      "alias gp='git push'",
    ].join('\n');

    const entries = zshParser.parse(content, ctx('~/.zshrc'));

    expect(entries[0]).toMatchObject({ keybind: '^z', action: 'Undo' });
    expect(entries[0].section).toBeUndefined();

    expect(entries[1]).toMatchObject({ keybind: '^a', section: 'CURSOR MOVEMENT' });
    expect(entries[2]).toMatchObject({ keybind: '^e', section: 'CURSOR MOVEMENT' });

    expect(entries[3]).toMatchObject({ keybind: 'gs', action: 'status', section: 'GIT ALIASES' });
    // Section persists until the next header, even without a trailing comment.
    expect(entries[4]).toMatchObject({ keybind: 'gp', action: 'git push', section: 'GIT ALIASES' });
  });

  it('does not treat plain prose comments as section headers', () => {
    const content = [
      '# TODO: clean this up',
      "bindkey '^a' beginning-of-line",
    ].join('\n');

    const entries = zshParser.parse(content, ctx('~/.zshrc'));
    expect(entries[0].section).toBeUndefined();
  });

  it('captures top-level function definitions when they have a trailing doc-comment', () => {
    const content = [
      'function c(      ## Smart CD',
      ') {',
      '  cd "$@"',
      '}',
      '',
      'mkcd() {  ## make and cd',
      '  mkdir -p "$1" && cd "$1"',
      '}',
      '',
      'function gco() {  # checkout helper',
      '  git checkout "$@"',
      '}',
    ].join('\n');

    const entries = zshParser.parse(content, ctx('~/.zshrc'));

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      keybind: 'c',
      action: 'Smart CD',
      category: 'alias',
      sourceLine: 1,
    });
    expect(entries[1]).toMatchObject({
      keybind: 'mkcd',
      action: 'make and cd',
      category: 'alias',
      sourceLine: 6,
    });
    expect(entries[2]).toMatchObject({
      keybind: 'gco',
      action: 'checkout helper',
      category: 'alias',
      sourceLine: 10,
    });
  });

  it('skips functions without a trailing doc-comment', () => {
    const content = [
      'function _internal() {',
      '  : helper',
      '}',
      '',
      'helper() {',
      '  : noop',
      '}',
    ].join('\n');

    const entries = zshParser.parse(content, ctx('~/.zshrc'));
    expect(entries).toEqual([]);
  });

  it('attaches the active section header to function entries', () => {
    const content = [
      '# --- NAVIGATION ---',
      'function c(  ## Smart CD',
      ') { cd "$@" }',
    ].join('\n');

    const entries = zshParser.parse(content, ctx('~/.zshrc'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      keybind: 'c',
      action: 'Smart CD',
      category: 'alias',
      section: 'NAVIGATION',
    });
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

describe('neovim-lua parser', () => {
  const nvimPath = '~/.config/nvim/lua/plugins/keymaps.lua';

  it('matches .lua files under any nvim directory', () => {
    expect(neovimLuaParser.match('~/.config/nvim/init.lua', '')).toBe(true);
    expect(neovimLuaParser.match('~/.config/nvim/lua/plugins/keymaps.lua', '')).toBe(true);
    expect(neovimLuaParser.match('~/.config/nvim/lua/util.lua', '')).toBe(true);
    expect(neovimLuaParser.match('~/.config/zsh/plugin.lua', '')).toBe(false);
    expect(neovimLuaParser.match('~/.config/nvim/init.vim', '')).toBe(false);
  });

  it('extracts a single-line vim.keymap.set with opts.desc as action', () => {
    const content = `vim.keymap.set('n', '<leader>ff', require('telescope.builtin').find_files, { desc = 'Find files' })`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      keybind: '<leader>ff', // `n` prefix suppressed — normal mode is implicit
      action: 'Find files',
      sourceLine: 1,
    });
  });

  it('keeps the mode prefix for non-normal modes', () => {
    const content = `vim.keymap.set('i', '<C-s>', '<Esc>:w<CR>', { desc = 'Save in insert mode' })`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    expect(entries[0].keybind).toBe('[i] <C-s>');
  });

  it('handles multi-line calls', () => {
    const content = `
vim.keymap.set(
  'n',
  '<leader>w',
  ':w<CR>',
  { desc = 'Save file', silent = true }
)
`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    expect(entries).toHaveLength(1);
    expect(entries[0].keybind).toBe('<leader>w');
    expect(entries[0].action).toBe('Save file');
    expect(entries[0].sourceLine).toBe(2);
  });

  it('handles array mode (multi-mode mappings)', () => {
    const content = `vim.keymap.set({'n', 'v'}, '<leader>y', '"+y', { desc = 'Yank to clipboard' })`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    expect(entries).toHaveLength(1);
    expect(entries[0].keybind).toBe('[n,v] <leader>y');
  });

  it('parses lazy.nvim `keys = { ... }` plugin-spec entries', () => {
    const content = `
return {
  "nvim-telescope/telescope.nvim",
  keys = {
    { "<leader>ff", "<cmd>Telescope find_files<cr>", desc = "Find files" },
    { "<leader>fg", function() require("telescope.builtin").live_grep() end, desc = "Live grep" },
    { "<leader>y",  "\\"+y", mode = { "n", "v" }, desc = "Yank to clipboard" },
    { "<leader>p",  "\\"+p", mode = "v", desc = "Paste from clipboard" },
  },
}
`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    const byKey = Object.fromEntries(entries.map((e) => [e.keybind, e.action]));

    expect(byKey).toMatchObject({
      '<leader>ff': 'Find files',
      '<leader>fg': 'Live grep',
      '[n,v] <leader>y': 'Yank to clipboard',
      '[v] <leader>p': 'Paste from clipboard',
    });
  });

  it('ignores `keys = { ... }` that is just a plain string array (not plugin keymaps)', () => {
    const content = `local keys = { "a", "b", "c" }`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    expect(entries).toEqual([]);
  });

  it('falls back to rhs when opts.desc is absent', () => {
    const content = `vim.keymap.set('n', '<leader>q', ':q<CR>')`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    expect(entries[0].action).toBe(':q<CR>');
  });

  it('summarizes non-string rhs (function bodies) when desc is absent', () => {
    const content = `vim.keymap.set('n', 'x', function() print('hi') end)`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toContain("function");
  });

  it('skips dynamic keymaps where mode is a variable (e.g. inside a loop)', () => {
    const content = `
for _, m in ipairs({'n', 'v'}) do
  vim.keymap.set(m, '<leader>x', ':echo "x"<CR>')
end
`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    expect(entries).toEqual([]);
  });

  it('skips dynamic keymaps where lhs is a variable', () => {
    const content = `
local lhs = '<leader>x'
vim.keymap.set('n', lhs, ':echo<CR>')
`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    expect(entries).toEqual([]);
  });

  it('supports the legacy vim.api.nvim_set_keymap API', () => {
    const content = `vim.api.nvim_set_keymap('n', '<leader>h', ':nohl<CR>', { noremap = true, silent = true, desc = 'Clear highlight' })`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('Clear highlight');
  });

  it('ignores calls inside full-line `--` comments', () => {
    const content = `
-- vim.keymap.set('n', '<leader>x', ':echo<CR>')
vim.keymap.set('n', '<leader>y', ':yank<CR>')
`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    expect(entries).toHaveLength(1);
    expect(entries[0].keybind).toBe('<leader>y');
  });

  it('handles multiple mappings in the same file with correct line numbers', () => {
    const content = `vim.keymap.set('n', '<leader>a', ':a<CR>')

vim.keymap.set('n', '<leader>b', ':b<CR>')
`;
    const entries = neovimLuaParser.parse(content, ctx(nvimPath));
    expect(entries).toHaveLength(2);
    expect(entries[0].sourceLine).toBe(1);
    expect(entries[1].sourceLine).toBe(3);
  });
});

describe('yazi parser schemas', () => {
  const yaziPath = '~/.config/yazi/keymap.toml';

  it('parses the newer CalVer shape (top-level [mgr].keymap inline array)', () => {
    const content = `
[mgr]
keymap = [
    { on = "r", run = "reload", desc = "Reload" },
    { on = "<Esc>", run = "escape", desc = "Exit" },
]

prepend_keymap = [
    { on = "!", run = 'shell "$SHELL"', desc = "Open shell here" },
]

[input]
keymap = [
    { on = "<CR>", run = "submit", desc = "Submit input" },
]
`;
    const entries = yaziParser.parse(content, ctx(yaziPath));
    const byKey = Object.fromEntries(entries.map((e) => [e.keybind, e]));

    expect(entries).toHaveLength(4);
    expect(byKey['r']).toMatchObject({ action: 'Reload', category: 'mgr' });
    expect(byKey['<Esc>']).toMatchObject({ action: 'Exit', category: 'mgr' });
    expect(byKey['!']).toMatchObject({ action: 'Open shell here', category: 'mgr' });
    expect(byKey['<CR>']).toMatchObject({ action: 'Submit input', category: 'input' });
  });

  it('parses the older nested shape ([[keymap.manager.prepend_keymap]])', () => {
    const content = `
[[keymap.manager.prepend_keymap]]
on = ['r']
run = 'reload'
desc = 'Reload'

[[keymap.input.keymap]]
on = ['<Esc>']
run = 'escape'
`;
    const entries = yaziParser.parse(content, ctx(yaziPath));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      keybind: 'r',
      action: 'Reload',
      category: 'manager',
    });
    expect(entries[1]).toMatchObject({
      keybind: '<Esc>',
      category: 'input',
    });
  });
});
