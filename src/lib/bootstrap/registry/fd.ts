import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * fd — a fast, user-friendly `find` alternative. Debian/Ubuntu ship the
 * binary as `fdfind` to avoid a namespace clash with the existing `fd`
 * (a file-descriptor utility from the `fd` package), so the install step
 * symlinks it to `fd` for the expected command name.
 *
 * Symlink destination mirrors deploy_dots.sh:354–362 and the bat entry
 * above: prefer `/usr/local/bin/fd` when sudo is cached (system-wide),
 * fall back to `$HOME/.local/bin/fd` (no sudo needed). Uses
 * `command -v fdfind` to resolve the real binary path for forward-compat
 * if the package moves the binary.
 *
 * Ported from deploy_dots.sh:354–362.
 */
export const fd: ToolDefinition = {
  id: 'fd',
  description: 'fast user-friendly find alternative',
  category: 'shell',
  requires: [],
  check: 'command -v fd >/dev/null 2>&1',
  install: `set -e
sudo apt-get install -y fd-find
if ! command -v fd >/dev/null 2>&1 && command -v fdfind >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null; then
    sudo ln -sf "$(command -v fdfind)" /usr/local/bin/fd
  else
    mkdir -p "$HOME/.local/bin"
    ln -sf "$(command -v fdfind)" "$HOME/.local/bin/fd"
  fi
fi`,
  update: `set -e
sudo apt-get install -y --only-upgrade fd-find
if ! command -v fd >/dev/null 2>&1 && command -v fdfind >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null; then
    sudo ln -sf "$(command -v fdfind)" /usr/local/bin/fd
  else
    mkdir -p "$HOME/.local/bin"
    ln -sf "$(command -v fdfind)" "$HOME/.local/bin/fd"
  fi
fi`,
  updateVia: 'system',
  detect: {
    paths: [],
    rcReferences: ['fd'],
  },
  // fd reads no dotfiles by default — behavior is all flags/env.
  associatedConfig: [],
};
