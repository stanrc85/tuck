import { loadConfig } from './config.js';

/**
 * Resolve the host-group filter for a command invocation.
 *
 * Precedence (mirrors the fallback chain in `fileTracking.ts` for consistency):
 *   1. explicit CLI `-g/--group` flag (`options.group`), when non-empty.
 *   2. `config.defaultGroups` from the merged config (shared + local).
 *   3. `undefined` — no filter, every tracked file is in scope.
 *
 * Used by `sync`, `restore`, `apply`, `list`, and `diff` so a host with
 * `defaultGroups: ["kali"]` set in `.tuckrc.local.json` scopes every
 * group-aware command to kali-tagged files automatically, without the user
 * having to pass `-g` on every invocation.
 */
export const resolveGroupFilter = async (
  tuckDir: string,
  options: { group?: string[] }
): Promise<string[] | undefined> => {
  if (options.group && options.group.length > 0) {
    return options.group;
  }
  const config = await loadConfig(tuckDir);
  if (config?.defaultGroups && config.defaultGroups.length > 0) {
    return config.defaultGroups;
  }
  return undefined;
};
