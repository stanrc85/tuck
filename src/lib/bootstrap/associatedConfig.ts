import { expandPath } from '../paths.js';
import type { ToolDefinition } from '../../schemas/bootstrap.schema.js';

/**
 * Intentionally tiny glob matcher for the `associatedConfig` patterns a
 * tool declares. Only three shapes are supported, matching the patterns
 * the built-ins actually use:
 *
 *   `prefix/**`  — `prefix` itself and anything under `prefix/`
 *   `prefix/*`   — direct children of `prefix` (one level, no descent)
 *   `literal`    — exact-path equality
 *
 * We don't pull in a full glob library here because the inputs are
 * short, static, and authored by tool authors — `**` recursion plus
 * literal paths covers every built-in and the common user-catalog case
 * ("these are my tool's configs"). If a future tool legitimately needs
 * `*.yaml` or brace expansion, upgrade to minimatch at that point.
 *
 * Both pattern and candidate are `expandPath`-normalized before matching
 * so `~/.config/nvim/**` correctly matches a restored file written to
 * `/home/alice/.config/nvim/init.lua`.
 */
export const matchesAssociatedConfig = (pattern: string, filePath: string): boolean => {
  const ep = expandPath(pattern);
  const ef = expandPath(filePath);

  if (ep.endsWith('/**')) {
    const prefix = ep.slice(0, -3);
    return ef === prefix || ef.startsWith(prefix + '/');
  }

  if (ep.endsWith('/*')) {
    const prefix = ep.slice(0, -2);
    if (!ef.startsWith(prefix + '/')) return false;
    const rest = ef.slice(prefix.length + 1);
    return rest.length > 0 && !rest.includes('/');
  }

  return ep === ef;
};

/**
 * True if any of `filePaths` matches any of the tool's `associatedConfig`
 * patterns. Returns false when the tool declares no associations (the
 * common case for tools without dotfiles like `git`, `curl`, etc.).
 */
export const toolMatchesRestoredFiles = (
  tool: ToolDefinition,
  filePaths: readonly string[]
): boolean => {
  if (tool.associatedConfig.length === 0) return false;
  return tool.associatedConfig.some((pattern) =>
    filePaths.some((path) => matchesAssociatedConfig(pattern, path))
  );
};
