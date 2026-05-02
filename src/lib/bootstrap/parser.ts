import { readFile } from 'fs/promises';
import { parse as parseToml, TomlError } from 'smol-toml';
import { ZodError } from 'zod';
import {
  bootstrapConfigSchema,
  type BootstrapConfig,
  type RawToolDefinition,
} from '../../schemas/bootstrap.schema.js';
import { BootstrapError } from '../../errors.js';
import { pathExists } from '../paths.js';
import { synthesizeTool } from './installerSynth.js';

/**
 * Parse and validate `bootstrap.toml` content.
 *
 * Three failure modes, all surfaced as `BootstrapError`:
 *   1. TOML syntax (forwards smol-toml's line/column + code excerpt).
 *   2. Schema validation (per-field Zod issues, flattened for readability).
 *   3. Duplicate tool IDs within the file.
 *
 * Bundle-member cross-refs and `requires` cross-refs are intentionally
 * NOT checked here — at parse time we don't see the built-in registry,
 * so a bundle like `kali = ["fzf"]` would false-positive on "unknown
 * tool" when `fzf` is a legitimate built-in. Validation happens at plan
 * time (see `planBootstrap`), which sees the fully-merged catalog.
 *
 * `sourcePath` is cosmetic — shown in error messages so users can jump
 * straight to the file. Omit when parsing ad-hoc strings (tests).
 */
export const parseBootstrapConfig = (content: string, sourcePath?: string): BootstrapConfig => {
  const fileLabel = sourcePath ?? 'bootstrap.toml';

  let rawToml: unknown;
  try {
    rawToml = parseToml(content);
  } catch (error) {
    if (error instanceof TomlError) {
      throw new BootstrapError(
        `Invalid TOML in ${fileLabel} (line ${error.line}, column ${error.column}): ${error.message}`,
        [error.codeblock.split('\n').filter((l) => l.length > 0).join('\n')]
      );
    }
    throw new BootstrapError(
      `Failed to parse ${fileLabel}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const result = bootstrapConfigSchema.safeParse(rawToml);
  if (!result.success) {
    throw new BootstrapError(
      `Invalid ${fileLabel}: ${formatZodError(result.error)}`,
      ['Fix the highlighted fields and re-run']
    );
  }

  const rawConfig = result.data;
  assertUniqueToolIds(rawConfig.tool, fileLabel);

  // Expand `installer` + `packages` shorthand into install/check/update
  // strings before any downstream consumer sees the catalog. After this
  // pass every tool has `install` populated as a string (raw-script tools
  // pass through; installer-shorthand tools get auto-generated scripts).
  const config: BootstrapConfig = {
    ...rawConfig,
    tool: rawConfig.tool.map(synthesizeTool),
  };

  return config;
};

/**
 * Read, parse, and validate `bootstrap.toml` at `filePath`. Missing file
 * throws a distinct error with a concrete fix hint so the caller can tell
 * it apart from a malformed file.
 */
export const loadBootstrapConfig = async (filePath: string): Promise<BootstrapConfig> => {
  if (!(await pathExists(filePath))) {
    throw new BootstrapError(`bootstrap.toml not found at ${filePath}`, [
      'Create a bootstrap.toml at the root of your dotfiles repo',
      'See the TASK-021 design notes for the expected schema',
    ]);
  }

  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (error) {
    throw new BootstrapError(
      `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return parseBootstrapConfig(content, filePath);
};

/**
 * Empty `BootstrapConfig` with all schema defaults applied. Use as the
 * fallback when `bootstrap.toml` doesn't exist on disk (callers commonly
 * still want a typed config so downstream code can iterate `config.tool`
 * unconditionally). Wraps `bootstrapConfigSchema.parse({})` and casts to
 * the post-synthesis `BootstrapConfig` shape — safe because the tool
 * array is empty and synthesis is a no-op for empty input.
 */
export const emptyBootstrapConfig = (): BootstrapConfig => ({
  ...bootstrapConfigSchema.parse({}),
  tool: [],
});

/**
 * Zod's default `.message` concatenates every issue into one string with
 * newlines. That's readable in isolation but hard to scan when it's nested
 * inside another error message. Flatten to `fieldPath: reason`, joined
 * with `; ` — one line per call site.
 */
const formatZodError = (error: ZodError): string => {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
};

const assertUniqueToolIds = (tools: RawToolDefinition[], fileLabel: string): void => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.id)) {
      duplicates.add(tool.id);
    }
    seen.add(tool.id);
  }
  if (duplicates.size > 0) {
    const ids = Array.from(duplicates).sort().join(', ');
    throw new BootstrapError(
      `Duplicate tool id(s) in ${fileLabel}: ${ids}`,
      ['Each [[tool]] entry must have a unique `id`']
    );
  }
};

