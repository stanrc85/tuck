import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * tealdeer — fast, rust-written tldr client. Installs from GitHub
 * releases (same pattern as neovim/yazi/pet) rather than apt because
 * Debian/Ubuntu ship versions old enough that their baked-in cache URL
 * is dead — symptom is the "could not find EOCD" zip-parse error when
 * `tldr --update` pulls an HTML error page instead of the archive.
 *
 * The upstream project moved from `dbrgn/tealdeer` to
 * `tealdeer-rs/tealdeer` in 2024; GitHub redirects the old path but we
 * use the canonical one. Linux arches land as per-arch single-binary
 * assets with Rust musl-target suffixes — we map `uname -m` to the
 * subset we want to support (x86_64, aarch64, armv7 — dropping i686
 * and soft-float arm).
 *
 * `check` is a plain presence test; version drift surfaces via the
 * state.json definition-hash mechanism in the picker when we bump
 * VERSION. Pet's `--version` grep was a cautionary tale (v2.10.3).
 *
 * Post-install step seeds the pages cache via `tldr --update` so the
 * first invocation doesn't surprise the user with an empty cache.
 * `|| true` keeps a transient network failure from failing the install.
 */
export const tealdeer: ToolDefinition = {
  id: 'tealdeer',
  description: 'fast tldr client',
  category: 'shell',
  version: '1.8.1',
  requires: [],
  check: 'command -v tldr >/dev/null 2>&1',
  install: `set -e
case "$(uname -m)" in
  x86_64) asset="tealdeer-linux-x86_64-musl" ;;
  aarch64|arm64) asset="tealdeer-linux-aarch64-musl" ;;
  armv7l) asset="tealdeer-linux-armv7-musleabihf" ;;
  *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac
url="https://github.com/tealdeer-rs/tealdeer/releases/download/v\${VERSION}/$asset"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/tldr"
chmod +x "$tmp/tldr"
if sudo -n true 2>/dev/null; then
  sudo mv "$tmp/tldr" /usr/local/bin/tldr
  TLDR_BIN=/usr/local/bin/tldr
else
  mkdir -p "$HOME/.local/bin"
  mv "$tmp/tldr" "$HOME/.local/bin/tldr"
  TLDR_BIN="$HOME/.local/bin/tldr"
fi
# Seed the pages cache so \`tldr <cmd>\` works immediately after install.
# Network failures here are non-fatal — the user can retry \`tldr --update\`.
"$TLDR_BIN" --update >/dev/null 2>&1 || true`,
  update: '@install',
  detect: {
    paths: ['~/.config/tealdeer'],
    rcReferences: ['tealdeer', 'tldr'],
  },
  associatedConfig: ['~/.config/tealdeer/**'],
};
