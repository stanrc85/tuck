import { readFile } from 'fs/promises';
import { basename, join } from 'path';
import { expandPath, pathExists } from '../paths.js';
import { loadBootstrapConfig } from './parser.js';
import { bootstrapConfigSchema } from '../../schemas/bootstrap.schema.js';
import { runCheck } from './runner.js';
import { detectPlatformVars, type BootstrapVars } from './interpolator.js';
import { toolMatchesRestoredFiles } from './associatedConfig.js';
import type { ToolDefinition } from '../../schemas/bootstrap.schema.js';

export interface MissingDep {
  id: string;
  description: string;
}

/**
 * Given the paths that `tuck restore` just wrote to disk, figure out
 * which catalog tools (a) claim those paths via `associatedConfig` and
 * (b) aren't currently installed on this host. The restore-tail prompt
 * then offers to run `tuck bootstrap --tools <ids>` on the result.
 *
 * Conservative by design — a tool with no `associatedConfig`, or one
 * whose check script happens to return 0, never surfaces here. False
 * positives are the expensive case (we'd prompt the user to install
 * something they already have), so we prefer false negatives.
 *
 * Pre-v3 this also overlaid a built-in registry against the restored set
 * for fresh hosts without a bootstrap.toml. The registry is gone in v3 —
 * the fresh-host signal now lives in `findUncoveredReferences`, which
 * cross-references restored content against a static well-known table.
 */
export const findMissingDeps = async (
  tuckDir: string,
  restoredFilePaths: readonly string[]
): Promise<MissingDep[]> => {
  if (restoredFilePaths.length === 0) return [];

  const configPath = join(tuckDir, 'bootstrap.toml');
  const config = (await pathExists(configPath))
    ? await loadBootstrapConfig(configPath)
    : bootstrapConfigSchema.parse({});

  const catalog = config.tool;
  if (catalog.length === 0) return [];

  // Second candidate signal: some tools (eza, ripgrep, fzf) ship no
  // config directory — users wire them up through shell aliases instead.
  // Scan restored shell-rc-like files for each tool's `rcReferences`
  // strings and treat a content match as equivalent to an associatedConfig
  // match. Without this, a freshly-restored ~/.config/zsh/aliases.zsh
  // containing `alias ls=eza` never triggers the install prompt.
  const rcShaped = restoredFilePaths.filter(isShellRcLikePath);
  const rcContents = await Promise.all(
    rcShaped.map(async (path) => ({
      path,
      content: await readFile(expandPath(path), 'utf-8').catch(() => null as string | null),
    }))
  );

  const matchesRcReferences = (tool: ToolDefinition): boolean => {
    if (tool.detect.rcReferences.length === 0) return false;
    return rcContents.some(
      ({ content }) =>
        content !== null &&
        tool.detect.rcReferences.some((ref) => content.includes(ref))
    );
  };

  const candidates = catalog.filter(
    (tool) => toolMatchesRestoredFiles(tool, restoredFilePaths) || matchesRcReferences(tool)
  );
  if (candidates.length === 0) return [];

  const platformVars = detectPlatformVars();
  const checks = await Promise.all(
    candidates.map(async (tool) => {
      const installed = await runCheckSafe(tool, platformVars);
      return { tool, installed };
    })
  );

  return checks
    .filter(({ installed }) => !installed)
    .map(({ tool }) => ({ id: tool.id, description: tool.description }));
};

const SHELL_RC_BASENAMES = new Set([
  '.zshrc',
  '.zshenv',
  '.zprofile',
  '.zlogin',
  '.zlogout',
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.profile',
  'config.fish',
]);

/**
 * True for paths that look like shell rc files — either by literal
 * basename (`.zshrc`, `.bashrc`, etc.) or by extension (`.zsh`, `.bash`,
 * `.sh`, `.fish`). Used to narrow content-scanning to files where
 * `rcReferences` strings are meaningful, avoiding false positives from
 * binary blobs or unrelated config that happens to contain short
 * substrings like "fzf" or "eza".
 */
const isShellRcLikePath = (filePath: string): boolean => {
  const base = basename(filePath);
  if (SHELL_RC_BASENAMES.has(base)) return true;
  return /\.(zsh|bash|sh|fish)$/i.test(base);
};

/**
 * Wrap `runCheck` so a malformed/crashing check script (rare — mostly
 * happens when `${VERSION}` is referenced on a version-less tool) is
 * treated as "not installed" rather than failing the whole prompt.
 * The user will see the bootstrap run surface the real error later.
 */
const runCheckSafe = async (
  tool: ToolDefinition,
  platformVars: Omit<BootstrapVars, 'VERSION'>
): Promise<boolean> => {
  try {
    const vars: BootstrapVars = { ...platformVars, VERSION: tool.version };
    return await runCheck(tool, vars);
  } catch {
    return false;
  }
};
