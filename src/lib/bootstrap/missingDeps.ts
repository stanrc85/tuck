import { join } from 'path';
import { pathExists } from '../paths.js';
import { loadBootstrapConfig } from './parser.js';
import { bootstrapConfigSchema } from '../../schemas/bootstrap.schema.js';
import { mergeWithRegistry } from './registry/index.js';
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
 * Registry-only mode: when `bootstrap.toml` is absent we still run the
 * built-ins against the restored set, which is the common fresh-host
 * case (user hasn't authored a bootstrap.toml but has nvim configs).
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

  const catalog = mergeWithRegistry(config);
  if (catalog.length === 0) return [];

  const candidates = catalog.filter((tool) =>
    toolMatchesRestoredFiles(tool, restoredFilePaths)
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
