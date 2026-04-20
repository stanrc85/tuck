import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * bat — cat(1) clone with syntax highlighting. Debian/Ubuntu ship the
 * binary as `batcat` to avoid a namespace clash with `bacula-console-qt`,
 * so the install step symlinks it to `~/.local/bin/bat` for the expected
 * command name. Update re-verifies the symlink in case it was removed.
 *
 * `$HOME` in the scripts is shell-expanded, not interpolator-expanded
 * (the interpolator only substitutes `${VAR}` for its five known names).
 * Ported from deploy_dots.sh:343–371 (per TASK-022 notes).
 */
export const bat: ToolDefinition = {
  id: 'bat',
  description: 'cat with syntax highlighting',
  category: 'shell',
  requires: [],
  check: 'command -v bat >/dev/null 2>&1',
  install: `set -e
sudo apt-get install -y bat
mkdir -p "$HOME/.local/bin"
if [ -x /usr/bin/batcat ] && [ ! -e "$HOME/.local/bin/bat" ]; then
  ln -sf /usr/bin/batcat "$HOME/.local/bin/bat"
fi`,
  update: `set -e
sudo apt-get install -y --only-upgrade bat
mkdir -p "$HOME/.local/bin"
if [ -x /usr/bin/batcat ] && [ ! -e "$HOME/.local/bin/bat" ]; then
  ln -sf /usr/bin/batcat "$HOME/.local/bin/bat"
fi`,
  detect: {
    paths: ['~/.config/bat'],
    rcReferences: ['bat'],
  },
};
