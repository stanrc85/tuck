import { z } from 'zod';

/**
 * Schema for `bootstrap.toml`, the declarative tool catalog that drives
 * `tuck bootstrap`. Lives at the root of the dotfiles repo.
 *
 * See TASK-021 for the full design rationale. Key invariants:
 *   - Tool IDs are kebab-case identifiers, unique across the catalog and
 *     across the built-in registry overlay.
 *   - `install` is the only required command. `update = "@install"` means
 *     "re-run install"; omitting `update` has the same effect.
 *   - `requires` values are other tool IDs resolved by the dep resolver;
 *     they are NOT free-form shell preconditions.
 *   - `detect` is best-effort signal for pre-checking entries in the picker,
 *     not a correctness gate.
 *
 * Cross-reference checks (bundle references an unknown tool ID, duplicate
 * IDs across array entries, `requires` cycles) are deliberately not in the
 * schema — they need the full parsed document and a helpful error shape.
 * The parser and resolver handle them with `BootstrapError`.
 */

const TOOL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export const toolIdSchema = z
  .string()
  .min(1)
  .regex(TOOL_ID_PATTERN, 'tool id must be kebab/snake case, starting with a letter or digit');

export const toolDetectSchema = z
  .object({
    /** Filesystem paths to probe; `~` expanded at detection time. */
    paths: z.array(z.string()).default([]),
    /** Substrings to grep for in the user's shell rc files. */
    rcReferences: z.array(z.string()).default([]),
  })
  .default({});

export const toolDefinitionSchema = z.object({
  /** Stable identifier used by `requires`, `bundles`, and the state file. */
  id: toolIdSchema,
  /** One-line human-readable description shown in the picker. */
  description: z.string().min(1),
  /** Optional grouping key for picker section headers (e.g. "shell"). */
  category: z.string().optional(),
  /** Version string interpolated into `install`/`update` as `${VERSION}`. */
  version: z.string().optional(),
  /** Other tool IDs that must be installed before this one. */
  requires: z.array(toolIdSchema).default([]),
  /** Shell command — exit 0 means "installed at the right version". */
  check: z.string().optional(),
  /** Shell command that installs the tool. Required. */
  install: z.string().min(1),
  /**
   * Shell command run by `tuck bootstrap update`. `@install` (or omitted)
   * means "re-run install", which is the common case for most tools.
   */
  update: z.string().optional(),
  /**
   * Who owns the update path.
   *   - unset / `'self'` (default): `tuck bootstrap update` runs `update`
   *     (or `install` as the fallback). The tool is offered in the
   *     picker, included in `--all`, and flagged by `--check` when
   *     drifted.
   *   - `'system'`: updates are delegated to the host package manager
   *     (apt/dnf/brew/…). `tuck bootstrap update` skips the tool under
   *     the picker / `--all` / `--check` — you run `apt upgrade` (or
   *     equivalent) instead. `--tools <id>` still forces the tool's
   *     `update` script to run, as an explicit escape hatch.
   * Install is unaffected either way — tuck still bootstraps the tool.
   */
  updateVia: z.enum(['self', 'system']).optional(),
  /** Signals used by the picker's auto-detection. */
  detect: toolDetectSchema,
  /**
   * Glob patterns (simple `prefix/**`, `prefix/*`, or literal) identifying
   * the dotfile paths this tool consumes. Matched against the *destinations*
   * produced by `tuck restore` — so the restore-tail prompt (TASK-048) can
   * detect "user just laid down `~/.config/nvim/...` but `nvim` isn't
   * installed" and offer to run bootstrap.
   *
   * Optional; tools that don't declare this never trigger the prompt.
   */
  associatedConfig: z.array(z.string()).default([]),
});

export const bootstrapConfigSchema = z.object({
  /**
   * Tool catalog. `[[tool]]` in TOML produces an array here. An empty
   * catalog is legal (the built-in registry still applies in later sessions).
   */
  tool: z.array(toolDefinitionSchema).default([]),
  /**
   * Named collections of tool IDs. `tuck bootstrap --bundle kali` expands
   * to the members of that bundle. Cross-refs to unknown tool IDs are
   * validated by the parser, not the schema.
   */
  bundles: z.record(z.array(toolIdSchema)).default({}),
  /**
   * Overrides for the built-in tool registry. `disabled` opts out of
   * specific built-in entries for users who want to supply their own.
   */
  registry: z
    .object({
      disabled: z.array(toolIdSchema).default([]),
    })
    .default({}),
});

export type ToolDetect = z.output<typeof toolDetectSchema>;
export type ToolDefinition = z.output<typeof toolDefinitionSchema>;
export type BootstrapConfig = z.output<typeof bootstrapConfigSchema>;
export type BootstrapConfigInput = z.input<typeof bootstrapConfigSchema>;
