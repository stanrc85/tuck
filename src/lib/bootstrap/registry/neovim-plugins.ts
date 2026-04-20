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
 *     - `lazy.sync()` — blocking wait for all lazy-managed plugins
 *     - `TSInstallSync` for the 13 languages the config expects. Each
 *       `-c` runs independently so a failure on one doesn't prevent
 *       `qa!` from firing at the end.
 *
 *   update (light, idempotent):
 *     - `Lazy! sync` — pulls new commits for every plugin; fast when
 *       nothing has changed.
 *
 * Why multiple `-c` flags instead of one chained lua string: the original
 * used `require("nvim-treesitter.install").install(...)` in a single lua
 * chunk, but that API is nil on nvim-treesitter main/v1.0 — the chunk
 * would error, never reach `vim.cmd("qa")`, and nvim would hang with
 * background mason/lazy jobs stuck waiting. `silent!` + ex-commands lets
 * us tolerate version drift (the parser list is a best-effort prime; the
 * user's own `ensure_installed` picks up any gaps on next nvim launch),
 * and isolating `qa!` into its own `-c` guarantees clean exit.
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
nvim --headless \\
  -c 'lua require("lazy").sync({ wait = true, show = false })' \\
  -c 'silent! lua require("lazy").load({ plugins = { "nvim-treesitter" } })' \\
  -c 'silent! TSInstallSync! markdown markdown_inline lua go bash python json jsonc yaml toml vim vimdoc regex' \\
  -c 'qa!'`,
  update: `nvim --headless "+Lazy! sync" +qa!`,
  detect: {
    paths: [
      '~/.config/nvim/lua/plugins',
      '~/.config/nvim/lazy-lock.json',
    ],
    rcReferences: [],
  },
};
