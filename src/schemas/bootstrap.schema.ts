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

/**
 * One entry in `packages = [...]` when `installer` is set. Strings are
 * shorthand for `{ name: <string> }` (formula/package name == binary name).
 * Use the object form only when the name probed for `check` differs from
 * the install name (brew formula `neovim` → binary `nvim`, etc.). `bin` is
 * brew-only — apt checks via `dpkg -s <name>` so the binary name is not
 * relevant.
 */
export const packageSpecSchema = z.union([
  z.string().min(1),
  z
    .object({
      name: z.string().min(1),
      bin: z.string().min(1).optional(),
    })
    .strict(),
]);

export const toolDefinitionSchema = z
  .object({
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
    /**
     * Shell command that installs the tool. Required UNLESS `installer` is
     * set, in which case tuck synthesizes install/check/update from
     * `packages` and the script is auto-generated. See `packageSpecSchema`.
     */
    install: z.string().min(1).optional(),
    /**
     * Shell command run by `tuck bootstrap update`. `@install` (or omitted)
     * means "re-run install", which is the common case for most tools.
     */
    update: z.string().optional(),
    /**
     * Opt-in shorthand: when set, tuck synthesizes `install`/`check`/`update`
     * from the `packages` list at parse time. Lets you maintain a single
     * array of formulas/packages instead of editing three shell snippets in
     * lockstep. Pairs with `packages`, `postInstall`, `postUpdate`.
     *
     *   - `'brew'` — Linux Homebrew. Install runs `brew install <names>`,
     *     update runs `brew update && brew upgrade <names> || true`, check
     *     probes `/home/linuxbrew/.linuxbrew/bin/<bin>` for each entry.
     *   - `'apt'`  — Debian/Ubuntu apt. Install runs `apt-get install -y
     *     <names>`, update runs `apt-get install -y --only-upgrade <names>`,
     *     check probes `dpkg -s <name>` for each entry.
     *
     * When `installer` is set, raw `install`/`check`/`update` must NOT be
     * set (pick one mode per block).
     */
    installer: z.enum(['brew', 'apt']).optional(),
    /**
     * Package list consumed by `installer`. Strings are shorthand for
     * `{ name }`; use the object form when binary differs from package name
     * (brew only — apt ignores `bin`).
     */
    packages: z.array(packageSpecSchema).optional(),
    /**
     * Optional shell appended to the synthesized `install` script. Use for
     * post-install hooks (symlinks, cache rebuilds, one-shot DB updates).
     * Only legal when `installer` is set.
     */
    postInstall: z.string().optional(),
    /**
     * Optional shell appended to the synthesized `update` script. Same rules
     * as `postInstall`.
     */
    postUpdate: z.string().optional(),
  /**
   * Who owns the update path.
   *   - unset / `'self'` (default): `tuck bootstrap update` runs `update`
   *     (or `install` as the fallback). The tool is offered in the
   *     picker, included in `--all`, and flagged by `--check` when
   *     drifted.
   *   - `'system'`: updates are delegated to the host package manager
   *     (apt/dnf/brew/…). `tuck bootstrap update` skips the tool under
   *     the picker / `--all` / `--check` — you run `apt upgrade` (or
   *     equivalent) instead. The deferred-log message names the package
   *     manager. `--tools <id>` still forces the tool's `update` script
   *     to run, as an explicit escape hatch.
   *   - `'manual'`: same skip behavior as `'system'`, but the log message
   *     instead says "Manually managed: <ids>". Use when a tool isn't
   *     owned by any package manager but you don't want it routinely
   *     re-running on every `tuck bootstrap update` (curl-from-GitHub
   *     fonts, one-shot cache rebuilds, anything you refresh manually
   *     when needed).
   * Install is unaffected by `updateVia` — tuck still bootstraps the tool.
   */
  updateVia: z.enum(['self', 'system', 'manual']).optional(),
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
  })
  .superRefine((tool, ctx) => {
    const usingInstaller = tool.installer !== undefined;
    const usingRawScripts = tool.install !== undefined;

    if (usingInstaller && usingRawScripts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `tool "${tool.id}": pick one mode — set either \`installer\`+\`packages\` OR raw \`install\`/\`check\`/\`update\`, not both`,
        path: ['installer'],
      });
    }

    if (!usingInstaller && !usingRawScripts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `tool "${tool.id}": missing \`install\` (or use \`installer\` + \`packages\` shorthand)`,
        path: ['install'],
      });
    }

    if (usingInstaller) {
      if (tool.packages === undefined || tool.packages.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tool "${tool.id}": \`installer\` requires a non-empty \`packages\` list`,
          path: ['packages'],
        });
      }
      if (tool.check !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tool "${tool.id}": \`check\` is auto-generated when \`installer\` is set — remove it`,
          path: ['check'],
        });
      }
      if (tool.update !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tool "${tool.id}": \`update\` is auto-generated when \`installer\` is set — remove it (use \`postUpdate\` for extras)`,
          path: ['update'],
        });
      }
      if (tool.installer === 'apt' && tool.packages) {
        for (let i = 0; i < tool.packages.length; i++) {
          const spec = tool.packages[i];
          if (typeof spec === 'object' && spec.bin !== undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `tool "${tool.id}": \`bin\` is brew-only (apt checks via \`dpkg -s\`) — remove from packages[${i}]`,
              path: ['packages', i, 'bin'],
            });
          }
        }
      }
    } else {
      if (tool.packages !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tool "${tool.id}": \`packages\` only valid when \`installer\` is set`,
          path: ['packages'],
        });
      }
      if (tool.postInstall !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tool "${tool.id}": \`postInstall\` only valid when \`installer\` is set (append to \`install\` directly)`,
          path: ['postInstall'],
        });
      }
      if (tool.postUpdate !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `tool "${tool.id}": \`postUpdate\` only valid when \`installer\` is set (append to \`update\` directly)`,
          path: ['postUpdate'],
        });
      }
    }
  });

export const bootstrapConfigSchema = z.object({
  /**
   * Tool catalog. `[[tool]]` in TOML produces an array here. An empty
   * catalog is legal — `tuck bootstrap` warns and exits cleanly.
   */
  tool: z.array(toolDefinitionSchema).default([]),
  /**
   * Named collections of tool IDs. `tuck bootstrap --bundle kali` expands
   * to the members of that bundle. Cross-refs to unknown tool IDs are
   * validated by the parser, not the schema.
   */
  bundles: z.record(z.array(toolIdSchema)).default({}),
  /**
   * **Deprecated** as of v3.0.0. Pre-v3 this field disabled built-in
   * registry entries (the 12 tools shipped in src/lib/bootstrap/registry/).
   * v3 removed the registry — `bootstrap.toml` is now the only source of
   * tool definitions, so there is nothing to disable.
   *
   * The field still parses cleanly so existing bootstrap.toml files (which
   * commonly list every former built-in here as a hedge) keep working
   * across the upgrade. The value is ignored at merge time.
   */
  registry: z
    .object({
      disabled: z.array(toolIdSchema).default([]),
    })
    .default({}),
  /**
   * Restore-flow knobs.
   *
   * `ignoreUncovered` suppresses well-known tool ids from the post-restore
   * "uncovered references" warning (see findUncoveredReferences). Useful
   * when a tool is referenced in your dotfiles but you intentionally don't
   * want tuck to flag or auto-install it (e.g., starship installed via a
   * one-off, or zimfw skipped on Kali). Ids here are matched literally
   * against the well-known table — unknown ids are no-ops, not errors,
   * so users can safely list ids that may or may not be in the table.
   */
  restore: z
    .object({
      ignoreUncovered: z.array(z.string()).default([]),
    })
    .default({}),
});

export type ToolDetect = z.output<typeof toolDetectSchema>;
export type PackageSpec = z.output<typeof packageSpecSchema>;

/**
 * Raw tool shape straight from Zod — `install` may be undefined if the
 * block uses the `installer` + `packages` shorthand. Used internally by
 * the parser/synthesizer.
 */
export type RawToolDefinition = z.output<typeof toolDefinitionSchema>;

/**
 * Public tool shape, post-synthesis. The parser guarantees `install` is
 * populated (raw scripts pass through; `installer` shorthand is expanded
 * by `synthesizeTool` before reaching any consumer). Treat this as the
 * canonical type — runner, resolver, state, etc. all consume it.
 */
export type ToolDefinition = Omit<RawToolDefinition, 'install'> & {
  install: string;
};

export type BootstrapConfig = Omit<z.output<typeof bootstrapConfigSchema>, 'tool'> & {
  tool: ToolDefinition[];
};
export type BootstrapConfigInput = z.input<typeof bootstrapConfigSchema>;
