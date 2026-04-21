import { readFile } from 'fs/promises';

/**
 * Canonical group names we understand. Flat one-to-one mapping onto the
 * `ID=` field in `/etc/os-release` — no version parsing, no hierarchy.
 * Kali 2024.x and 2025.x both map to `kali`; Ubuntu 22.04 and 24.04 both
 * map to `ubuntu`; and so on.
 *
 * Adding a new distro is a one-line addition here — no migration, no
 * compatibility shim, no version-aware logic. The point of the flat map
 * is that the group name is the human-meaningful thing (users type
 * `tuck sync -g kali`), and the OS-version churn is not.
 */
const KNOWN_OS_IDS = new Set([
  'kali',
  'ubuntu',
  'debian',
  'arch',
  'fedora',
  'rhel',
  'centos',
  'opensuse',
  'alpine',
  'nixos',
]);

/**
 * Read `/etc/os-release` and extract the `ID=` field. Returns the
 * lowercased ID if it's in our known set, `null` otherwise (unknown
 * distro, non-Linux, or file missing).
 *
 * This is deliberately narrow — we only want to seed `defaultGroups` with
 * a canonical name the user is likely to use across their repo. If their
 * ID is exotic (e.g. `manjaro`, `pop`), we skip rather than guess.
 */
export const detectOsGroup = async (): Promise<string | null> => {
  if (process.platform !== 'linux') return null;

  let content: string;
  try {
    content = await readFile('/etc/os-release', 'utf-8');
  } catch {
    return null;
  }

  const match = content.match(/^ID="?([^"\n]+)"?/m);
  if (!match) return null;

  const id = match[1]!.trim().toLowerCase();
  return KNOWN_OS_IDS.has(id) ? id : null;
};
