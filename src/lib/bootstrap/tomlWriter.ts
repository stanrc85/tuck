import { writeFile, readFile } from 'fs/promises';
import { stringify } from 'smol-toml';
import { pathExists } from '../paths.js';
import type { BootstrapConfig } from '../../schemas/bootstrap.schema.js';

/**
 * Serialize + write a validated `BootstrapConfig` back to disk.
 *
 * Important caveat: `smol-toml.stringify` produces a canonical document
 * — comments and blank-line layout in the user's hand-authored
 * `bootstrap.toml` are NOT preserved. The `tuck bootstrap bundle`
 * subcommands are the only callers today, and the first write is a
 * one-way door. `hadCommentsBefore` reports whether the file had
 * comments prior to overwrite so the command layer can warn the user
 * once at the call site.
 */
export interface WriteResult {
  path: string;
  bytesWritten: number;
  /** True iff the pre-write content contained `#`-prefixed comment lines. */
  hadCommentsBefore: boolean;
}

const hasComments = (content: string): boolean =>
  content.split('\n').some((line) => /^\s*#/.test(line));

/**
 * We serialize in two passes because `smol-toml.stringify` emits
 * top-level scalars and tables in insertion order. We reorder so
 * `[[tool]]` arrays land first (matching the house convention in the
 * example templates), followed by `[bundles]`, then `[registry]`.
 * Any extra top-level keys (future-proofing) pass through untouched.
 */
const normalizeForStringify = (config: BootstrapConfig): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  if (config.tool.length > 0) {
    out.tool = config.tool;
  }
  if (Object.keys(config.bundles).length > 0) {
    out.bundles = config.bundles;
  }
  if ((config.registry.disabled ?? []).length > 0) {
    out.registry = { disabled: config.registry.disabled };
  }
  return out;
};

export const writeBootstrapToml = async (
  filePath: string,
  config: BootstrapConfig
): Promise<WriteResult> => {
  const existed = await pathExists(filePath);
  let hadCommentsBefore = false;
  if (existed) {
    try {
      const prior = await readFile(filePath, 'utf-8');
      hadCommentsBefore = hasComments(prior);
    } catch {
      // Read errors on the prior file are non-fatal — we'll overwrite anyway,
      // the user just doesn't get the comment-loss warning. Better than
      // aborting the write and leaving the bundle unsaved.
    }
  }

  const serialized = stringify(normalizeForStringify(config));
  await writeFile(filePath, serialized, 'utf-8');
  return {
    path: filePath,
    bytesWritten: Buffer.byteLength(serialized, 'utf-8'),
    hadCommentsBefore,
  };
};
