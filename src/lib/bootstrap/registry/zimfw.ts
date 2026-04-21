import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * ZimFW — modular zsh framework. Installs via the upstream `curl|zsh`
 * bootstrapper (same pattern as oh-my-zsh / prezto). `requires: ['zsh']`
 * both orders the install behind zsh *and* guarantees the `| zsh` pipe
 * has a shell to run against on an otherwise bare host.
 *
 * **Kali skip-guard** — Kali ships with its own opinionated zsh setup
 * (oh-my-zsh-style rc + prompt), so installing ZimFW there would
 * collide with the existing framework. Both `check` and `install`
 * short-circuit on Kali: `check` reports "already installed" so the
 * tool is neither flagged as missing by restore-tail nor pre-selected
 * in the picker, and `install` additionally no-ops when forced via
 * `--rerun zimfw` as belt-and-braces.
 *
 * Layout compatibility: the installer clones the framework into
 * `~/.zim` and seeds a starter `~/.zimrc` only when one isn't already
 * present — so a user whose dotfiles ship a custom `.zimrc` (either at
 * `~/.zimrc` or XDG-style at `~/.config/zsh/.zimrc`) gets their file
 * honoured after restore. Both placements are wired into `associatedConfig`
 * so restore-tail (TASK-048) flags ZimFW as missing regardless of layout.
 */
export const zimfw: ToolDefinition = {
  id: 'zimfw',
  description: 'modular zsh framework',
  category: 'shell',
  requires: ['zsh'],
  check:
    'if [ -f /etc/os-release ] && (. /etc/os-release && [ "$ID" = "kali" ]); then exit 0; fi; test -d "$HOME/.zim"',
  install: `set -e
if [ -f /etc/os-release ] && (. /etc/os-release && [ "$ID" = "kali" ]); then
  echo "Skipping ZimFW on Kali (Kali ships its own zsh setup)."
  exit 0
fi
curl -fsSL https://raw.githubusercontent.com/zimfw/install/master/install.zsh | zsh`,
  update: 'zsh -c "source \\"$HOME/.zim/init.zsh\\" && zimfw upgrade && zimfw update"',
  detect: {
    paths: ['~/.zim', '~/.zimrc', '~/.config/zsh/.zimrc'],
    rcReferences: ['zimfw'],
  },
  associatedConfig: ['~/.zimrc', '~/.config/zsh/.zimrc'],
};
