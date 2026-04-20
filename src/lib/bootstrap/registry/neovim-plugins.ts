import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * neovim-plugins — syncs lazy.nvim-managed plugins via a headless nvim
 * invocation. Idempotent: running it twice when plugins are already up
 * to date is a no-op. Depends on `neovim`; the resolver will install it
 * first if both are selected.
 *
 * `check` uses presence of `lazy-lock.json` as a proxy for "plugins
 * have been synced at least once." Re-run with `--rerun neovim-plugins`
 * to pick up plugin changes after editing `~/.config/nvim/lua/plugins/`.
 */
export const neovimPlugins: ToolDefinition = {
  id: 'neovim-plugins',
  description: 'sync lazy.nvim-managed neovim plugins',
  category: 'editors',
  requires: ['neovim'],
  check: 'test -f "$HOME/.config/nvim/lazy-lock.json"',
  install: `nvim --headless "+Lazy! sync" +qa`,
  update: '@install',
  detect: {
    paths: [
      '~/.config/nvim/lua/plugins',
      '~/.config/nvim/lazy-lock.json',
    ],
    rcReferences: [],
  },
};
