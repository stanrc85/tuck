import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * zsh — z shell. Debian/Ubuntu/Kali all package it as `zsh` with no
 * post-install fuss — same class as fzf/eza/bat/fd/ripgrep. Installing
 * zsh does *not* change the user's login shell; the chsh step is
 * prompted separately at the end of `tuck bootstrap` (see
 * `maybePromptForShellChange` in src/commands/bootstrap.ts).
 *
 * `associatedConfig` covers the canonical zsh rc set so a user who
 * restores a `.zshrc` onto a fresh host gets a missing-deps prompt at
 * restore-tail (TASK-048) offering `tuck bootstrap --tools zsh`.
 */
export const zsh: ToolDefinition = {
  id: 'zsh',
  description: 'z shell',
  category: 'shell',
  requires: [],
  check: 'command -v zsh >/dev/null 2>&1',
  install: 'sudo apt-get install -y zsh',
  update: 'sudo apt-get install -y --only-upgrade zsh',
  detect: {
    paths: ['~/.zshrc', '~/.zshenv', '~/.zprofile', '~/.zlogin', '~/.zimrc'],
    rcReferences: ['zsh'],
  },
  associatedConfig: ['~/.zshrc', '~/.zshenv', '~/.zprofile', '~/.zlogin', '~/.zlogout'],
};
