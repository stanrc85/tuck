import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * neovim-plugins — lazy.nvim + treesitter setup for neovim. Depends on
 * `neovim`; the resolver installs it first when both are selected.
 *
 * `install` and `update` differ meaningfully, mirroring the
 * configure_nvim vs sync_nvim split in deploy_dots.sh:
 *
 *   install (heavy, first-time):
 *     - `npm install -g tree-sitter-cli` if npm is available (needed
 *       for parser compilation on some systems)
 *     - `lazy.sync()` followed by an explicit treesitter parser install
 *       for the 13 languages the config expects. 5-minute wait cap
 *       inherited from the script — long enough for a cold parser
 *       compile on slow machines.
 *
 *   update (light, idempotent):
 *     - `Lazy! sync` — pulls new commits for every plugin; fast when
 *       nothing has changed.
 *
 * `check` probes lazy.nvim's *runtime* plugin dir
 * (`~/.local/share/nvim/lazy/nvim-treesitter`) — that directory is only
 * created by a real `lazy.sync()` run, so it's a reliable
 * "plugins have actually been installed" signal. Earlier versions used
 * `~/.config/nvim/lazy-lock.json`, but users who track that file in their
 * dotfiles repo get it restored by `tuck restore` before bootstrap runs,
 * which made the check pass without any plugins ever being installed.
 * Re-run with `--rerun neovim-plugins` to pick up plugin changes after
 * editing `~/.config/nvim/lua/plugins/`.
 *
 * Ported from deploy_dots.sh:292–309 (configure_nvim + sync_nvim).
 */
export const neovimPlugins: ToolDefinition = {
  id: 'neovim-plugins',
  description: 'sync lazy.nvim-managed neovim plugins',
  category: 'editors',
  requires: ['neovim'],
  check: 'test -d "$HOME/.local/share/nvim/lazy/nvim-treesitter"',
  install: `set -e
if command -v npm >/dev/null 2>&1; then
  sudo npm install -g tree-sitter-cli
fi
nvim --headless -c 'lua require("lazy").sync({ wait = true }); require("lazy").load({ plugins = { "nvim-treesitter" } }); require("nvim-treesitter.install").install({ "markdown", "markdown_inline", "lua", "go", "bash", "python", "json", "jsonc", "yaml", "toml", "vim", "vimdoc", "regex" }, { force = true }):wait(300000); vim.cmd("qa")'`,
  update: `nvim --headless "+Lazy! sync" +qa`,
  detect: {
    paths: [
      '~/.config/nvim/lua/plugins',
      '~/.config/nvim/lazy-lock.json',
    ],
    rcReferences: [],
  },
};
