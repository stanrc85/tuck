import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * bat — cat(1) clone with syntax highlighting. Debian/Ubuntu ship the
 * binary as `batcat` to avoid a namespace clash with `bacula-console-qt`,
 * so the install step symlinks it to `bat` for the expected command name.
 *
 * Symlink destination mirrors deploy_dots.sh:346–351: prefer
 * `/usr/local/bin/bat` when sudo is cached (system-wide, every user),
 * else fall back to `$HOME/.local/bin/bat` (no sudo needed). Uses
 * `command -v batcat` to resolve the real binary path in case the
 * package moves it off `/usr/bin/` in a future release.
 *
 * `$HOME` in the scripts is shell-expanded, not interpolator-expanded
 * (the interpolator only substitutes `${VAR}` for its five known names).
 * Ported from deploy_dots.sh:343–371.
 */
export const bat: ToolDefinition = {
  id: 'bat',
  description: 'cat with syntax highlighting',
  category: 'shell',
  requires: [],
  check: 'command -v bat >/dev/null 2>&1',
  install: `set -e
sudo apt-get install -y bat
if ! command -v bat >/dev/null 2>&1 && command -v batcat >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null; then
    sudo ln -sf "$(command -v batcat)" /usr/local/bin/bat
  else
    mkdir -p "$HOME/.local/bin"
    ln -sf "$(command -v batcat)" "$HOME/.local/bin/bat"
  fi
fi
# Rebuild bat's theme+syntax cache so any restored files under
# ~/.config/bat/{themes,syntaxes} are actually known to bat — without
# this, \`bat --theme=DraculaPRO\` reports "unknown theme" even though
# the .tmTheme file is on disk.
BAT_BIN="$(command -v bat 2>/dev/null || command -v batcat 2>/dev/null || true)"
if [ -n "$BAT_BIN" ]; then
  "$BAT_BIN" cache --build >/dev/null 2>&1 || true
fi`,
  update: `set -e
sudo apt-get install -y --only-upgrade bat
if ! command -v bat >/dev/null 2>&1 && command -v batcat >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null; then
    sudo ln -sf "$(command -v batcat)" /usr/local/bin/bat
  else
    mkdir -p "$HOME/.local/bin"
    ln -sf "$(command -v batcat)" "$HOME/.local/bin/bat"
  fi
fi
BAT_BIN="$(command -v bat 2>/dev/null || command -v batcat 2>/dev/null || true)"
if [ -n "$BAT_BIN" ]; then
  "$BAT_BIN" cache --build >/dev/null 2>&1 || true
fi`,
  detect: {
    paths: ['~/.config/bat'],
    rcReferences: ['bat'],
  },
  associatedConfig: ['~/.config/bat/**'],
};
