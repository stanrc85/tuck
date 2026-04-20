import { loadConfig } from './config.js';
import { getAllGroups } from './manifest.js';
import { GroupRequiredError } from '../errors.js';

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

/**
 * Refuse to proceed when the repo uses host-groups but this host hasn't been
 * assigned one. Protects write-side commands (`tuck sync`, `tuck push`) from
 * silently contributing cross-host file noise.
 *
 * Passes when any of:
 *   - caller supplied `-g/--group` (one-shot override)
 *   - `config.defaultGroups` is non-empty (host has been assigned)
 *   - manifest has ≤1 distinct groups (no ambiguity — single- or zero-group
 *     repos are unaffected, keeping the check backwards-compatible)
 *
 * Throws `GroupRequiredError` otherwise. The error points at
 * `tuck restore --all` because that flow now includes the assignment prompt.
 */
export const assertHostGroupAssigned = async (
  tuckDir: string,
  options: { group?: string[] } = {}
): Promise<void> => {
  if (options.group && options.group.length > 0) {
    return;
  }
  const config = await loadConfig(tuckDir);
  if (config?.defaultGroups && config.defaultGroups.length > 0) {
    return;
  }
  const allGroups = await getAllGroups(tuckDir);
  if (allGroups.length <= 1) {
    return;
  }
  throw new GroupRequiredError(allGroups);
};
