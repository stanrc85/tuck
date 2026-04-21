import { BootstrapError } from '../../errors.js';
import type {
  BootstrapConfig,
  ToolDefinition,
} from '../../schemas/bootstrap.schema.js';
import { detectTool } from './detect.js';
import { runCheck } from './runner.js';
import { detectPlatformVars, type BootstrapVars } from './interpolator.js';

/**
 * Pure operations over a loaded `BootstrapConfig`'s `bundles` map. Each
 * function either mutates a returned config (via immutable replacement)
 * or reports a user-visible BootstrapError with actionable suggestions.
 *
 * The command layer (src/commands/bootstrap-bundle.ts) wraps these with
 * UX (prompts, logger). Keeping the logic here lets tests exercise the
 * decision matrix without spawning commander or mocking prompts.
 */

export interface BundleSummary {
  name: string;
  memberCount: number;
}

export const listBundles = (config: BootstrapConfig): BundleSummary[] => {
  return Object.entries(config.bundles)
    .map(([name, members]) => ({ name, memberCount: members.length }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export type MemberStatus = 'installed' | 'detected' | 'missing' | 'unknown';

export interface BundleMemberInfo {
  id: string;
  description?: string;
  status: MemberStatus;
}

export interface BundleDetails {
  name: string;
  members: BundleMemberInfo[];
}

/**
 * Look up a bundle + compute per-member status. `unknown` means the id
 * isn't in the merged catalog (likely user-typo or the tool was removed
 * without cleaning up references). `installed` means `check` returned 0.
 * `detected` means detection signals matched even though no check
 * command succeeded (useful for tools with weak `check` scripts).
 * `missing` is everything else — the honest "would install" state.
 */
export const showBundle = async (
  config: BootstrapConfig,
  catalog: readonly ToolDefinition[],
  bundleName: string
): Promise<BundleDetails> => {
  const members = config.bundles[bundleName];
  if (!members) {
    throw new BootstrapError(`No bundle named "${bundleName}"`, [
      `Known bundles: ${Object.keys(config.bundles).sort().join(', ') || '(none)'}`,
    ]);
  }

  const byId = new Map(catalog.map((t) => [t.id, t]));
  const platformVars = detectPlatformVars();

  const infos = await Promise.all(
    members.map(async (id): Promise<BundleMemberInfo> => {
      const tool = byId.get(id);
      if (!tool) return { id, status: 'unknown' };

      const vars: BootstrapVars = { ...platformVars, VERSION: tool.version };
      const [installed, detection] = await Promise.all([
        runCheckSafe(tool, vars),
        detectTool(tool),
      ]);

      const status: MemberStatus = installed
        ? 'installed'
        : detection.detected
          ? 'detected'
          : 'missing';
      return { id, description: tool.description, status };
    })
  );

  return { name: bundleName, members: infos };
};

const runCheckSafe = async (tool: ToolDefinition, vars: BootstrapVars): Promise<boolean> => {
  try {
    return await runCheck(tool, vars);
  } catch {
    return false;
  }
};

/**
 * Return a new config with the bundle set to the given members. Enforces
 * (a) every member resolves in the merged catalog, (b) no collision with
 * an existing bundle name unless `overwrite` is true.
 */
export const createBundle = (
  config: BootstrapConfig,
  catalog: readonly ToolDefinition[],
  bundleName: string,
  members: readonly string[],
  options: { overwrite?: boolean } = {}
): BootstrapConfig => {
  if (bundleName.length === 0) {
    throw new BootstrapError('Bundle name is required');
  }

  const unique = Array.from(new Set(members));
  if (unique.length === 0) {
    throw new BootstrapError(`Bundle "${bundleName}" would have no members`, [
      'Pass at least one tool id: `tuck bootstrap bundle create <name> <tool...>`',
    ]);
  }

  assertMembersKnown(unique, catalog);

  if (config.bundles[bundleName] && !options.overwrite) {
    throw new BootstrapError(`Bundle "${bundleName}" already exists`, [
      `Use \`tuck bootstrap bundle delete ${bundleName}\` first, or \`bundle add/rm\` to edit members`,
    ]);
  }

  return {
    ...config,
    bundles: { ...config.bundles, [bundleName]: unique },
  };
};

export const addToBundle = (
  config: BootstrapConfig,
  catalog: readonly ToolDefinition[],
  bundleName: string,
  toolId: string
): { config: BootstrapConfig; alreadyMember: boolean } => {
  const current = config.bundles[bundleName];
  if (!current) {
    throw new BootstrapError(`No bundle named "${bundleName}"`, [
      `Known bundles: ${Object.keys(config.bundles).sort().join(', ') || '(none)'}`,
    ]);
  }

  assertMembersKnown([toolId], catalog);

  if (current.includes(toolId)) {
    return { config, alreadyMember: true };
  }

  return {
    config: {
      ...config,
      bundles: { ...config.bundles, [bundleName]: [...current, toolId] },
    },
    alreadyMember: false,
  };
};

export const removeFromBundle = (
  config: BootstrapConfig,
  bundleName: string,
  toolId: string
): { config: BootstrapConfig; wasMember: boolean } => {
  const current = config.bundles[bundleName];
  if (!current) {
    throw new BootstrapError(`No bundle named "${bundleName}"`, [
      `Known bundles: ${Object.keys(config.bundles).sort().join(', ') || '(none)'}`,
    ]);
  }

  if (!current.includes(toolId)) {
    return { config, wasMember: false };
  }

  return {
    config: {
      ...config,
      bundles: { ...config.bundles, [bundleName]: current.filter((m) => m !== toolId) },
    },
    wasMember: true,
  };
};

export const deleteBundle = (
  config: BootstrapConfig,
  bundleName: string
): BootstrapConfig => {
  if (!(bundleName in config.bundles)) {
    throw new BootstrapError(`No bundle named "${bundleName}"`, [
      `Known bundles: ${Object.keys(config.bundles).sort().join(', ') || '(none)'}`,
    ]);
  }
  const next = { ...config.bundles };
  delete next[bundleName];
  return { ...config, bundles: next };
};

const assertMembersKnown = (
  members: readonly string[],
  catalog: readonly ToolDefinition[]
): void => {
  const knownIds = new Set(catalog.map((t) => t.id));
  const unknown = members.filter((id) => !knownIds.has(id));
  if (unknown.length === 0) return;

  const known = Array.from(knownIds).sort().join(', ');
  throw new BootstrapError(
    `Unknown tool id${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
    [`Available ids: ${known}`]
  );
};
