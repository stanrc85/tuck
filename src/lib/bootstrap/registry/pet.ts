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
 * Ported from deploy_dots.sh:201–218 (per TASK-022 notes).
 */
export const pet: ToolDefinition = {
  id: 'pet',
  description: 'CLI snippet manager',
  category: 'shell',
  version: '0.3.7',
  requires: [],
  check: `command -v pet >/dev/null 2>&1 && pet --version 2>/dev/null | grep -q "\${VERSION}"`,
  install: `set -e
url="https://github.com/knqyf263/pet/releases/download/v\${VERSION}/pet_\${VERSION}_linux_\${ARCH}.deb"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/pet.deb"
sudo dpkg -i "$tmp/pet.deb"`,
  update: '@install',
  detect: {
    paths: ['~/.config/pet'],
    rcReferences: [],
  },
};
