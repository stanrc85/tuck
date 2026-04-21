import type {
  BootstrapConfig,
  ToolDefinition,
} from '../../../schemas/bootstrap.schema.js';
import { fzf } from './fzf.js';
import { eza } from './eza.js';
import { bat } from './bat.js';
import { fd } from './fd.js';
import { ripgrep } from './ripgrep.js';
import { neovim } from './neovim.js';
import { neovimPlugins } from './neovim-plugins.js';
import { pet } from './pet.js';
import { yazi } from './yazi.js';

/**
 * Built-in tool catalog overlaid onto the user's `bootstrap.toml`. Each
 * entry is a plain TS module under this directory so it can use arch/OS
 * helpers without re-parsing TOML. Users who want to customise any
 * built-in override it with their own `[[tool]]` entry (user wins) or
 * drop it via `[registry] disabled = [...]`.
 *
 * Exposed as a frozen array so downstream code can't mutate it in place
 * by accident. Tests that need a different built-in set inject via
 * `mergeWithRegistry(config, { builtIns })`.
 */
export const BUILT_IN_TOOLS: readonly ToolDefinition[] = Object.freeze([
  fzf,
  eza,
  bat,
  fd,
  ripgrep,
  neovim,
  neovimPlugins,
  pet,
  yazi,
]);

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
