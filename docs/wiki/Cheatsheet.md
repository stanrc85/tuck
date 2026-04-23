# Cheatsheet

`tuck cheatsheet` walks your tracked dotfiles and emits a markdown (or JSON) document listing every keybind, alias, and binding tuck can extract. Useful when you haven't used a tool in a while and can't remember what you bound to `ctrl-g` last year.

For flags and synopsis, see [Command Reference — tuck cheatsheet](./Command-Reference#tuck-cheatsheet). This page covers what each parser understands, the JSON format, and consumer recipes for piping into other tools.

## How it works

1. Walks the manifest.
2. For each tracked file, matches its source path against format-specific patterns (e.g. `.zshrc` → zsh parser, `tmux.conf` → tmux parser).
3. Runs the parser against the file's content to pull out bindings / aliases.
4. Emits markdown (default) or JSON.

By default output goes to `<tuckDir>/cheatsheet.md` so the cheatsheet is versioned alongside your dotfiles — commit it with the next `tuck sync` to get a diffable history of how your keybinds evolved.

## Supported parsers

### tmux

Captures `bind-key` and `bind` directives from `tmux.conf`. When the `-N "note"` flag is present (tmux 3.1+), its value becomes the action description.

```tmux
# Parsed as { key: 'prefix |', action: 'split window horizontally' }
bind-key | split-window -h \; select-pane -t :.+
```

### zsh

Captures `bindkey` and `alias`. Handles both forms of each:

```zsh
bindkey '^R' history-incremental-search-backward
bindkey -M vicmd 'k' up-line-or-history
alias ll='ls -lah'
alias gs='git status'
```

Naive quote-counter for comment-stripping has a known edge case on escaped quotes inside strings (rare — documented in the parser's source comments).

### yazi

Parses `keymap.toml` section-by-section (manager, tabs, input, select, etc.). Each entry's `on` becomes the key, `run` becomes the action, and `desc` (if present) becomes the description.

```toml
[[manager.keymap]]
on   = "<Space>"
run  = "toggle --state=none"
desc = "Toggle the current selection state"
```

### Neovim (lua)

Captures `vim.keymap.set` and `vim.api.nvim_set_keymap`. Uses `opts.desc` when present.

```lua
vim.keymap.set('n', '<leader>ff', builtin.find_files, { desc = 'Find files' })
```

**Known limitations:**

- Dynamic keymaps (mode or lhs driven by a variable or loop) are silently skipped — only literal string arguments are captured. A future parser upgrade could surface a `warnings: string[]` signal when entries are skipped, so you know *why* something isn't in the output.
- Doesn't handle `[[...]]` long strings or block comments.

## Formats

### Markdown (default)

Grouped by source file and section. Each table has the same shape: `Key | Action | Description`.

```
# Cheatsheet

## tmux

### ~/.tmux.conf

| Key | Action | Description |
|-----|--------|-------------|
| prefix \| | split-window -h | split window horizontally |
| prefix - | split-window -v | split window vertically |

## zsh

### ~/.zshrc

| Key | Action |
|-----|--------|
| ^R | history-incremental-search-backward |

### Aliases

| Alias | Command |
|-------|---------|
| ll | ls -lah |
| gs | git status |
```

### JSON (`--format json`)

Flat `entries[]` array + a `sections[]` summary for schema stability. Every optional field emits explicit `null` so downstream consumers can rely on the shape.

```json
{
  "version": "1.0",
  "generatedAt": "2026-04-23T12:34:56Z",
  "sections": [
    { "parser": "tmux", "source": "~/.tmux.conf", "count": 14 },
    { "parser": "zsh",  "source": "~/.zshrc",     "count": 38 }
  ],
  "entries": [
    {
      "parser": "tmux",
      "source": "~/.tmux.conf",
      "key": "prefix |",
      "action": "split-window -h",
      "description": "split window horizontally",
      "category": null
    }
  ]
}
```

Useful for piping into other tools (fzf pickers, web dashboards, etc.) — see recipes below.

## Consumer recipes

### zsh + fzf picker

Fuzzy-pick a keybind you vaguely remember. Drop this function into your `~/.zshrc`:

```zsh
keys() {
  tuck cheatsheet --format json --stdout \
    | jq -r '.entries[] | "\(.key)\t\(.action)\t\(.description // "")\t\(.source)"' \
    | column -t -s$'\t' \
    | fzf --ansi \
          --preview-window=wrap \
          --preview 'echo {}' \
          --header="tuck cheatsheet — fuzzy-pick a keybind"
}
```

Run `keys` → type `find file` → see every binding that mentions "find" or "file" across every tool.

### Pipe into `glow` or `bat`

```bash
tuck cheatsheet --stdout | glow -
tuck cheatsheet --stdout | bat --language=markdown
```

### jq queries

```bash
# Every alias starting with "g"
tuck cheatsheet --format json --stdout \
  | jq '.entries[] | select(.parser == "zsh" and (.key // "" | startswith("g")))'

# Count per parser
tuck cheatsheet --format json --stdout \
  | jq '.sections[] | "\(.parser): \(.count)"'

# Keys bound to anything with "window" in the action
tuck cheatsheet --format json --stdout \
  | jq '.entries[] | select(.action | test("window"))'
```

### Scheduled regeneration

Keep `<tuckDir>/cheatsheet.md` always-current via a `postSync` hook (see [Hooks](./Hooks)):

```json
{
  "hooks": {
    "postSync": "tuck cheatsheet --output ~/.tuck/cheatsheet.md"
  }
}
```

Every `tuck sync` regenerates the cheatsheet, so the committed version always matches the tracked dotfiles at that commit.

## Filters

Restrict to specific parsers:

```bash
tuck cheatsheet --sources tmux,zsh         # only tmux + zsh
tuck cheatsheet --sources neovim-lua       # only nvim bindings
```

Restrict by host-group:

```bash
tuck cheatsheet -g work                    # only files tagged `work`
```

Both can combine. Combined with `--format json` and a jq filter, you can build very specific per-context cheatsheets.

## Adding your own parser

The plugin-parser system is deferred to a follow-up (see TASK-050-FOLLOWUP). Today, adding a parser means editing the tuck source (`src/lib/cheatsheet/parsers/`) and opening a PR. Planned additions:

- Vim (non-lua)
- Hyprland / Sway / i3
- Helix
- Alacritty / Kitty / WezTerm
- Bash (`bindkey` + `alias`)
- VS Code `keybindings.json`

If you've written one you'd like upstreamed, a PR against `src/lib/cheatsheet/parsers/` is welcome.

## See also

- [Command Reference — tuck cheatsheet](./Command-Reference#tuck-cheatsheet)
- [Hooks](./Hooks) — for the scheduled-regeneration recipe
