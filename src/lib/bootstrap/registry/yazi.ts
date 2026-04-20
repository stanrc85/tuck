import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * yazi — blazing-fast terminal file manager (sxyazi/yazi). Ships zipped
 * binaries named by Rust target triple (`yazi-x86_64-unknown-linux-gnu.zip`),
 * which doesn't match our interpolator's Debian-style `${ARCH}`. We
 * construct the triple inline from `$(uname -m)` in the install script —
 * that falls through the interpolator (it only matches `${VAR}` names it
 * knows) and bash expands it at run time.
 *
 * Install destination mirrors deploy_dots.sh:324–329: prefer
 * `/usr/local/bin/` when sudo credentials are already cached (so the
 * binary is on the system PATH for every user), else fall back to
 * `$HOME/.local/bin/` (no sudo required).
 *
 * Version is a manual pin. deploy_dots.sh uses `releases/latest/download`
 * for yazi; we pin so definitionHash drift surfaces in the picker when
 * we bump. Accept a minor reproducibility divergence from the script
 * here — the tuck bootstrap model prefers pinned.
 *
 * Ported from deploy_dots.sh:311–340.
 */
export const yazi: ToolDefinition = {
  id: 'yazi',
  description: 'terminal file manager',
  category: 'shell',
  version: '0.4.0',
  requires: [],
  check: `command -v yazi >/dev/null 2>&1 && yazi --version 2>/dev/null | grep -q "\${VERSION}"`,
  install: `set -e
arch="$(uname -m)-unknown-linux-gnu"
url="https://github.com/sxyazi/yazi/releases/download/v\${VERSION}/yazi-$arch.zip"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/yazi.zip"
unzip -q "$tmp/yazi.zip" -d "$tmp/extract"
if sudo -n true 2>/dev/null; then
  sudo mv "$tmp/extract"/yazi-*/ya "$tmp/extract"/yazi-*/yazi /usr/local/bin/
else
  mkdir -p "$HOME/.local/bin"
  mv "$tmp/extract"/yazi-*/ya "$tmp/extract"/yazi-*/yazi "$HOME/.local/bin/"
fi`,
  update: '@install',
  detect: {
    paths: ['~/.config/yazi'],
    rcReferences: [],
  },
};
