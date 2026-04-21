import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * ripgrep — fast recursive grep alternative. Debian/Ubuntu ship the
 * package as `ripgrep` with the binary as `rg`, no namespace clash
 * (unlike `fd`/`bat`), so no post-install symlink is needed.
 *
 * apt-packaged rg lags upstream by a minor version or two on LTS, but
 * ripgrep is extremely stable API-wise — no plugin ecosystem that could
 * break on version skew, unlike nvim/yazi. Stay on apt; same class as
 * fzf/eza/bat/fd.
 */
export const ripgrep: ToolDefinition = {
  id: 'ripgrep',
  description: 'fast recursive grep alternative',
  category: 'shell',
  requires: [],
  check: 'command -v rg >/dev/null 2>&1',
  install: 'sudo apt-get install -y ripgrep',
  update: 'sudo apt-get install -y --only-upgrade ripgrep',
  detect: {
    paths: [],
    rcReferences: ['rg', 'ripgrep'],
  },
  // ripgrep reads no dotfiles by default (respects .gitignore in-tree only).
  associatedConfig: [],
};
