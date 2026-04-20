import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * yazi — blazing-fast terminal file manager (sxyazi/yazi). Ships zipped
 * binaries named by Rust target triple (`yazi-x86_64-unknown-linux-gnu.zip`),
 * which doesn't match our interpolator's Debian-style `${ARCH}`. We
 * construct the triple inline from `$(uname -m)` in the install script —
 * that falls through the interpolator (it only matches `${VAR}` names it
 * knows) and bash expands it at run time.
 *
 * Version is a manual pin — bump when rolling the registry forward.
 * Ported from deploy_dots.sh:312–340 (per TASK-022 notes).
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
mkdir -p "$HOME/.local/bin"
cp "$tmp/extract"/yazi-*/yazi "$HOME/.local/bin/"
cp "$tmp/extract"/yazi-*/ya "$HOME/.local/bin/"`,
  update: '@install',
  detect: {
    paths: ['~/.config/yazi'],
    rcReferences: [],
  },
};
