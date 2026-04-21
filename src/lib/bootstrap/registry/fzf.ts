import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * fzf — command-line fuzzy finder. Debian/Ubuntu package is maintained
 * and recent enough for most workflows; users who need the latest can
 * override with their own `[[tool]]` entry.
 */
export const fzf: ToolDefinition = {
  id: 'fzf',
  description: 'command-line fuzzy finder',
  category: 'shell',
  requires: [],
  check: 'command -v fzf >/dev/null 2>&1',
  install: 'sudo apt-get install -y fzf',
  update: 'sudo apt-get install -y --only-upgrade fzf',
  detect: {
    paths: ['~/.fzf.zsh', '~/.fzf.bash'],
    rcReferences: ['fzf'],
  },
  associatedConfig: ['~/.fzf.zsh', '~/.fzf.bash', '~/.config/fzf/**'],
};
