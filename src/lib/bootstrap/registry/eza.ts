import type { ToolDefinition } from '../../../schemas/bootstrap.schema.js';

/**
 * eza — modern replacement for `ls`. Lives in Debian trixie / Ubuntu
 * 24.04+ as the `eza` package; older distros need the upstream repo,
 * which is out of scope here (users can override with their own entry).
 */
export const eza: ToolDefinition = {
  id: 'eza',
  description: 'modern replacement for ls',
  category: 'shell',
  requires: [],
  check: 'command -v eza >/dev/null 2>&1',
  install: 'sudo apt-get install -y eza',
  update: 'sudo apt-get install -y --only-upgrade eza',
  detect: {
    // No config directory; detection is rc-based (alias) or binary presence.
    paths: [],
    rcReferences: ['eza'],
  },
};
