import { loadConfig } from './config.js';
import { getAllGroups } from './manifest.js';
import {
  GroupRequiredError,
  HostReadOnlyError,
  HostRoleUnassignedError,
} from '../errors.js';

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

/**
 * Refuse to proceed on write-side commands (`sync`, `push`, `add`,
 * `remove`) when `readOnlyGroups` is configured AND the current host is
 * either:
 *   - assigned to a group that intersects `readOnlyGroups` → read-only, or
 *   - unassigned (empty `defaultGroups`) → role not declared yet, block
 *     conservatively so a not-yet-configured consumer host doesn't create
 *     cross-host commit noise.
 *
 * Passes when any of:
 *   - caller passed `--force-write` (explicit one-shot override)
 *   - `TUCK_FORCE_WRITE=true` env var (CI escape hatch)
 *   - `config.readOnlyGroups` is empty (feature not configured —
 *     backward-compatible for users who never set this)
 *   - host's groups don't intersect `readOnlyGroups`
 *
 * Throws `HostReadOnlyError` for the matched-group case or
 * `HostRoleUnassignedError` for the unassigned case — different
 * remediation: the former wants `tuck update`; the latter wants
 * `tuck config set defaultGroups <role>`.
 */
export const assertHostNotReadOnly = async (
  tuckDir: string,
  options: { forceWrite?: boolean } = {}
): Promise<void> => {
  if (options.forceWrite) return;
  if (process.env.TUCK_FORCE_WRITE === 'true') return;

  const config = await loadConfig(tuckDir);
  const readOnlyGroups = config?.readOnlyGroups ?? [];
  if (readOnlyGroups.length === 0) return;

  const hostGroups = config?.defaultGroups ?? [];
  if (hostGroups.length === 0) {
    throw new HostRoleUnassignedError(readOnlyGroups);
  }

  const matched = hostGroups.filter((g) => readOnlyGroups.includes(g));
  if (matched.length === 0) return;

  throw new HostReadOnlyError(matched, readOnlyGroups);
};
