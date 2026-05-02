import { readFile } from 'fs/promises';
import { join } from 'path';
import { expandPath, pathExists } from '../paths.js';
import { loadBootstrapConfig, emptyBootstrapConfig } from './parser.js';
import { matchesAssociatedConfig } from './associatedConfig.js';
import { containsToken, isShellRcLikePath } from './rcDetection.js';
import { WELL_KNOWN_TOOLS, type WellKnownTool } from './wellKnownTools.js';
import type { ToolDefinition } from '../../schemas/bootstrap.schema.js';

export interface UncoveredReference {
  id: string;
  description: string;
  brewFormula: string;
  installType: 'brew' | 'manual';
}

/**
 * Given the paths `tuck restore` just wrote to disk, find well-known tools
 * (the legacy registry's 12 ids) that the dotfiles reference but the user's
 * `bootstrap.toml` doesn't define a covering `[[tool]]` block for.
 *
 * Two-stage filter:
 *   1. **Reference detection** — scan rc-file contents for `rcReferences`
 *      tokens (word-boundary match), and restored paths against the
 *      well-known tool's `paths` globs. A hit on either says "the dotfiles
 *      use this tool".
 *   2. **Coverage check** — for each referenced tool, look at the user's
 *      `[[tool]]` blocks. Covered if any block:
 *        - shares the well-known id
 *        - mentions the binary or brewFormula in its install/update/check text
 *        - lists the well-known id in its `detect.rcReferences`
 *        - claims an overlapping `detect.paths` pattern
 *
 * Coverage is intentionally liberal — a single weak signal counts. False
 * negatives (real gap, missed warning) are recoverable later when bootstrap
 * runs; false positives (uncovered warning for a tool the user already
 * installs some other way) are noise the user has to dismiss every restore.
 *
 * Returns an empty array when no `bootstrap.toml` exists OR no well-known
 * tools are referenced. The caller decides whether to warn or auto-install.
 */
export const findUncoveredReferences = async (
  tuckDir: string,
  restoredFilePaths: readonly string[]
): Promise<UncoveredReference[]> => {
  if (restoredFilePaths.length === 0) return [];

  const configPath = join(tuckDir, 'bootstrap.toml');
  const config = (await pathExists(configPath))
    ? await loadBootstrapConfig(configPath)
    : emptyBootstrapConfig();

  const rcShaped = restoredFilePaths.filter(isShellRcLikePath);
  const rcContents = await Promise.all(
    rcShaped.map(async (path) => {
      const content = await readFile(expandPath(path), 'utf-8').catch(
        () => null as string | null
      );
      return { path, content };
    })
  );

  const ignored = new Set(config.restore.ignoreUncovered);
  const referenced = WELL_KNOWN_TOOLS.filter(
    (tool) => !ignored.has(tool.id) && isReferenced(tool, restoredFilePaths, rcContents)
  );
  if (referenced.length === 0) return [];

  return referenced
    .filter((tool) => !isCoveredByUserConfig(tool, config.tool))
    .map((tool) => ({
      id: tool.id,
      description: tool.description,
      brewFormula: tool.brewFormula,
      installType: tool.installType,
    }));
};

const isReferenced = (
  tool: WellKnownTool,
  restoredPaths: readonly string[],
  rcContents: readonly { path: string; content: string | null }[]
): boolean => {
  if (
    tool.paths.some((pattern) =>
      restoredPaths.some((path) => matchesAssociatedConfig(pattern, path))
    )
  ) {
    return true;
  }

  if (tool.rcReferences.length === 0) return false;
  return rcContents.some(
    ({ content }) =>
      content !== null &&
      tool.rcReferences.some((ref) => containsToken(content, ref))
  );
};

const isCoveredByUserConfig = (
  tool: WellKnownTool,
  userTools: readonly ToolDefinition[]
): boolean => {
  for (const user of userTools) {
    if (user.id === tool.id) return true;

    if (user.detect.rcReferences.includes(tool.id)) return true;

    // Path-claim overlap: if the user's tool block claims a path that
    // overlaps with the well-known tool's paths, count as covered. Catches
    // the pattern where a user defines a "config-only" tool block that
    // doesn't install anything but signals ownership of a directory.
    if (
      tool.paths.length > 0 &&
      user.detect.paths.some((up) =>
        tool.paths.some((tp) => pathClaimsOverlap(up, tp))
      )
    ) {
      return true;
    }

    // Check whether install/update/check commands mention the tool's binary
    // or brew formula. Word-boundary regex avoids `bat` matching `combat`
    // or `fd` matching `xargs -fd`. Tokens are short and meant to appear as
    // standalone arguments (`brew install fzf yazi`, `command -v rg`).
    const haystack = `${user.install} ${user.update} ${user.check ?? ''}`;
    if (tool.binary && containsToken(haystack, tool.binary)) return true;
    if (tool.brewFormula && containsToken(haystack, tool.brewFormula)) {
      return true;
    }
  }
  return false;
};

/**
 * True when two glob-style path patterns claim overlapping ground after
 * `~`-expansion. Trailing `/**` and `/*` are stripped to a directory
 * prefix; two prefixes overlap if either is a prefix of the other (or
 * they're equal). Doesn't try to be a full glob algebra — covers the
 * shapes the existing matcher supports.
 */
const pathClaimsOverlap = (a: string, b: string): boolean => {
  const norm = (p: string): string =>
    expandPath(p).replace(/\/\*\*$/, '').replace(/\/\*$/, '');
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  return na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`);
};


