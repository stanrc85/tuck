import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * neovim — hyperextensible Vim-based editor.
 *
 * Installed from GitHub's tracking `stable` tag (always points at the
 * current stable release) rather than apt. The apt-packaged neovim on
 * Kali/Ubuntu LTS typically lags upstream by a full minor version, and
 * the lua/plugin ecosystem increasingly assumes 0.10+ features — users
 * hit "plugin failed to load" errors on fresh hosts installing the
 * distro version. Matches the yazi/pet GitHub-release pattern.
 *
 * Install destination mirrors the bat/fd/yazi convention: prefer
 * system-wide (`/opt/nvim` + `/usr/local/bin/nvim` symlink) when sudo
 * credentials are cached, fall back to `$HOME/.local/opt/nvim` +
 * `$HOME/.local/bin/nvim` otherwise. Release artifacts use `uname -m`
 * mapped to neovim's naming (`x86_64` → `x86_64`, `aarch64`/`arm64` →
 * `arm64`).
 *
 * Version tracking: `stable` is a moving tag on GitHub that advances
 * with each upstream release. Re-run `tuck bootstrap update --tools
 * neovim -f` after neovim ships a new version to pull it in — our
 * definition-hash won't change on upstream bumps since the version
 * string is constant, so there's no automatic picker signal here.
 * Users who want reproducible pinning can override this tool in their
 * own bootstrap.toml with a concrete `vX.Y.Z` version.
 */
export const neovim: ToolDefinition = {
  id: 'neovim',
  description: 'hyperextensible Vim-based editor',
  category: 'editors',
  version: 'stable',
  requires: [],
  check: 'command -v nvim >/dev/null 2>&1',
  install: `set -e
case "$(uname -m)" in
  x86_64) arch_suffix="x86_64" ;;
  aarch64|arm64) arch_suffix="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac
url="https://github.com/neovim/neovim/releases/download/\${VERSION}/nvim-linux-\${arch_suffix}.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/nvim.tar.gz"
tar -xzf "$tmp/nvim.tar.gz" -C "$tmp"
src_dir="$(find "$tmp" -maxdepth 1 -type d -name 'nvim-*' | head -1)"
[ -n "$src_dir" ] || { echo "neovim archive missing expected top-level directory"; exit 1; }
if sudo -n true 2>/dev/null; then
  sudo rm -rf /opt/nvim
  sudo mv "$src_dir" /opt/nvim
  sudo ln -sf /opt/nvim/bin/nvim /usr/local/bin/nvim
else
  mkdir -p "$HOME/.local/opt" "$HOME/.local/bin"
  rm -rf "$HOME/.local/opt/nvim"
  mv "$src_dir" "$HOME/.local/opt/nvim"
  ln -sf "$HOME/.local/opt/nvim/bin/nvim" "$HOME/.local/bin/nvim"
fi`,
  update: '@install',
  detect: {
    paths: ['~/.config/nvim'],
    rcReferences: ['nvim'],
  },
  associatedConfig: ['~/.config/nvim/**'],
};
