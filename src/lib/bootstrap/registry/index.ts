import type {
  BootstrapConfig,
  ToolDefinition,
} from '../../../schemas/bootstrap.schema.js';

/**
 * Built-in tool catalog overlaid onto the user's `bootstrap.toml`. Kept
 * empty for TASK-021; TASK-022 will populate it with entries for fzf,
 * eza, bat, neovim, neovim-plugins, pet, and yazi (plain TS modules so
 * each entry can use arch/OS helpers without re-parsing TOML).
 *
 * Exposed as a frozen array so downstream code can't mutate it in place
 * by accident. Tests that need a different built-in set inject via
 * `mergeWithRegistry(config, { builtIns })`.
 */
export const BUILT_IN_TOOLS: readonly ToolDefinition[] = Object.freeze([]);

export interface MergeOptions {
  /** Override the built-in list. Primarily used by tests. */
  builtIns?: readonly ToolDefinition[];
}

/**
 * Combine the user's catalog with the built-in registry.
 *
 * Rules (order matters):
 *   1. `config.registry.disabled` drops the named built-ins entirely.
 *      Disabling only affects the built-in overlay — user `[[tool]]`
 *      entries with those ids stay; that's the whole point of disabling.
 *   2. User `[[tool]]` entries with the same id as a built-in override
 *      it (user wins). Useful when a user wants a custom version or
 *      install script while still taking advantage of bundles.
 *
 * Return order: user tools first (declared order), then the un-disabled,
 * un-overridden built-ins (catalog order). This order is what the
 * resolver consumes, and keeping it predictable means `tuck bootstrap`
 * output is stable across runs.
 */
export const mergeWithRegistry = (
  config: BootstrapConfig,
  options: MergeOptions = {}
): ToolDefinition[] => {
  const builtIns = options.builtIns ?? BUILT_IN_TOOLS;
  const disabled = new Set(config.registry.disabled ?? []);
  const userIds = new Set(config.tool.map((t) => t.id));

  const overlay = builtIns.filter((t) => !disabled.has(t.id) && !userIds.has(t.id));
  return [...config.tool, ...overlay];
};
