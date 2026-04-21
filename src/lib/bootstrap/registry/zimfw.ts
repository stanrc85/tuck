import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * ZimFW — modular zsh framework. Installs via the upstream `curl|zsh`
 * bootstrapper (same pattern as oh-my-zsh / prezto). `requires: ['zsh']`
 * both orders the install behind zsh *and* guarantees the `| zsh` pipe
 * has a shell to run against on an otherwise bare host.
 *
 * The installer clones the framework into `~/.zim` and seeds a starter
 * `~/.zimrc` only when one isn't already present — so a user whose
 * dotfiles ship a custom `.zimrc` gets their file honoured after
 * restore. `associatedConfig: ['~/.zimrc']` lets restore-tail
 * (TASK-048) flag ZimFW as missing when a user restores `.zimrc` onto
 * a fresh host.
 *
 * Users on distros that already ship an opinionated zsh setup (Kali's
 * pre-wired oh-my-zsh-style rc, for example) can disable this entry
 * via `[registry] disabled = ["zimfw"]` in their `bootstrap.toml`.
 */
export const zimfw: ToolDefinition = {
  id: 'zimfw',
  description: 'modular zsh framework',
  category: 'shell',
  requires: ['zsh'],
  check: 'test -d "$HOME/.zim"',
  install:
    'curl -fsSL https://raw.githubusercontent.com/zimfw/install/master/install.zsh | zsh',
  update: 'zsh -c "source \\"$HOME/.zim/init.zsh\\" && zimfw upgrade && zimfw update"',
  detect: {
    paths: ['~/.zim', '~/.zimrc'],
    rcReferences: ['zimfw'],
  },
  associatedConfig: ['~/.zimrc'],
};
