import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * pet — simple CLI snippet manager (knqyf263/pet). Ships a `.deb` per
 * release; filename format is `pet_${VERSION}_linux_${ARCH}.deb` where
 * ARCH is Debian-style (amd64/arm64/armhf), matching our interpolator.
 *
 * Version is a manual pin — definition-hash drift will surface in the
 * picker as "outdated" when we bump it. Check pet's GitHub releases and
 * bump here when rolling the registry forward.
 *
 * `dpkg -i` falls back to `apt -f install -y` on failure so missing
 * dependencies auto-install, matching the deploy_dots.sh:238 pattern.
 *
 * Ported from deploy_dots.sh:220–246.
 */
export const pet: ToolDefinition = {
  id: 'pet',
  description: 'CLI snippet manager',
  category: 'shell',
  version: '1.0.1',
  requires: [],
  // Just test for presence — version drift is surfaced by the state.json
  // definition-hash mechanism in the picker, and pet's `--version` output
  // format isn't stable across releases (older versions emit
  // `pet version X.Y.Z`, newer ones route it through stderr on some
  // builds). A grep against the rendered version was producing spurious
  // "not installed" results on re-runs — reinstall-on-every-restore.
  check: 'command -v pet >/dev/null 2>&1',
  install: `set -e
url="https://github.com/knqyf263/pet/releases/download/v\${VERSION}/pet_\${VERSION}_linux_\${ARCH}.deb"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/pet.deb"
sudo dpkg -i "$tmp/pet.deb" || sudo apt-get -f install -y`,
  update: '@install',
  detect: {
    paths: ['~/.config/pet'],
    rcReferences: [],
  },
  associatedConfig: ['~/.config/pet/**'],
};
