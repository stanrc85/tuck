import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * neovim — hyperextensible Vim-based editor. Distro package is usually
 * recent enough; users wanting bleeding-edge can swap in the PPA or
 * AppImage via their own `[[tool]]` entry.
 */
export const neovim: ToolDefinition = {
  id: 'neovim',
  description: 'hyperextensible Vim-based editor',
  category: 'editors',
  requires: [],
  check: 'command -v nvim >/dev/null 2>&1',
  install: 'sudo apt-get install -y neovim',
  update: 'sudo apt-get install -y --only-upgrade neovim',
  detect: {
    paths: ['~/.config/nvim'],
    rcReferences: ['nvim'],
  },
};
