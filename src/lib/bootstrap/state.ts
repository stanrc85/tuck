import { readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { ensureDir, pathExists } from 'fs-extra';
import { z } from 'zod';
import { DEFAULT_TUCK_DIR } from '../../constants.js';
import { BootstrapError } from '../../errors.js';
import type { ToolDefinition } from '../../schemas/bootstrap.schema.js';

/**
 * Append `.bootstrap-state.json` to the tuck repo's `.gitignore` if
 * missing. Called whenever state is saved so users whose `.tuck/` was
 * initialized before this rule landed automatically get the gitignore
 * update on first bootstrap. Mirrors `ensureLocalConfigGitignored` in
 * `src/lib/config.ts` — same class of "per-host state leaking via sync"
 * bug fixed the same way. Idempotent; best-effort.
 */
const ensureBootstrapStateGitignored = async (tuckDir: string): Promise<void> => {
  const gitignorePath = join(tuckDir, '.gitignore');
  let existing = '';
  if (await pathExists(gitignorePath)) {
    try {
      existing = await readFile(gitignorePath, 'utf-8');
    } catch {
      return;
    }
  }

  const lines = existing.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(STATE_FILE)) {
    return;
  }

  const separator = existing.trim() ? '\n\n' : '';
  const updated =
    existing.trim() +
    `${separator}# Per-host bootstrap install state (never commit — varies per machine)\n${STATE_FILE}\n`;

  try {
    await writeFile(gitignorePath, updated, 'utf-8');
  } catch {
    // Best effort — not worth blocking a state-file write on gitignore flakiness.
  }
};

/**
 * Persistent record of "what's installed on this host" for `tuck bootstrap`.
 * Lives at `~/.tuck/.bootstrap-state.json` (per-host; never synced). See
 * TASK-021 for the shape. Missing file is indistinguishable from "nothing
 * installed yet," which is the common first-run state.
 *
 * Concurrency: the bootstrap command processes tools sequentially by
 * design, so load-then-save races aren't a concern here. If that ever
 * changes, revisit — a naive last-writer-wins would clobber entries.
 */

export const STATE_FILE = '.bootstrap-state.json';
export const STATE_VERSION = 1;

export const toolStateEntrySchema = z.object({
  /** ISO-8601 timestamp of the install that produced this entry. */
  installedAt: z.string().min(1),
  /** Copy of `tool.version` at install time (optional — versionless tools). */
  version: z.string().optional(),
  /** SHA-256 of the normalized tool definition; drives drift detection. */
  definitionHash: z.string().min(1),
});

export const bootstrapStateSchema = z.object({
  version: z.literal(STATE_VERSION),
  tools: z.record(toolStateEntrySchema).default({}),
});

export type ToolStateEntry = z.output<typeof toolStateEntrySchema>;
export type BootstrapState = z.output<typeof bootstrapStateSchema>;

export const getBootstrapStatePath = (tuckDir: string = DEFAULT_TUCK_DIR): string =>
  join(tuckDir, STATE_FILE);

export const emptyBootstrapState = (): BootstrapState => ({
  version: STATE_VERSION,
  tools: {},
});

/**
 * Read and validate the state file. Missing file → empty state. Malformed
 * JSON or schema violations throw `BootstrapError` with a fix hint pointing
 * at the file so the user can delete it to reset.
 */
export const loadBootstrapState = async (
  tuckDir: string = DEFAULT_TUCK_DIR
): Promise<BootstrapState> => {
  const path = getBootstrapStatePath(tuckDir);
  if (!(await pathExists(path))) {
    return emptyBootstrapState();
  }

  let raw: unknown;
  try {
    const content = await readFile(path, 'utf-8');
    raw = JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new BootstrapError(`${STATE_FILE} contains invalid JSON`, [
        `Fix or delete ${path} to reset`,
      ]);
    }
    throw new BootstrapError(
      `Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const result = bootstrapStateSchema.safeParse(raw);
  if (!result.success) {
    throw new BootstrapError(`Invalid ${STATE_FILE}: ${result.error.message}`, [
      `Delete ${path} to reset`,
    ]);
  }
  return result.data;
};

/** Serialize state to disk, creating the tuck dir if needed. */
export const saveBootstrapState = async (
  state: BootstrapState,
  tuckDir: string = DEFAULT_TUCK_DIR
): Promise<void> => {
  const path = getBootstrapStatePath(tuckDir);
  await ensureDir(dirname(path));

  const result = bootstrapStateSchema.safeParse(state);
  if (!result.success) {
    throw new BootstrapError(
      `Refusing to save malformed bootstrap state: ${result.error.message}`
    );
  }

  try {
    await writeFile(path, JSON.stringify(result.data, null, 2) + '\n', 'utf-8');
  } catch (error) {
    throw new BootstrapError(
      `Failed to write ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  await ensureBootstrapStateGitignored(tuckDir);
};

export interface RecordToolOptions {
  version?: string;
  tuckDir?: string;
  /** Override the installedAt timestamp (tests). */
  now?: Date;
}

/**
 * Add or update a tool's state entry, then persist. Returns the updated
 * state so callers can inspect without re-loading.
 */
export const recordToolInstalled = async (
  id: string,
  definitionHash: string,
  options: RecordToolOptions = {}
): Promise<BootstrapState> => {
  const tuckDir = options.tuckDir ?? DEFAULT_TUCK_DIR;
  const state = await loadBootstrapState(tuckDir);
  state.tools[id] = {
    installedAt: (options.now ?? new Date()).toISOString(),
    ...(options.version !== undefined ? { version: options.version } : {}),
    definitionHash,
  };
  await saveBootstrapState(state, tuckDir);
  return state;
};

/** Drop a tool's state entry (no-op if absent), then persist. */
export const removeToolState = async (
  id: string,
  tuckDir: string = DEFAULT_TUCK_DIR
): Promise<BootstrapState> => {
  const state = await loadBootstrapState(tuckDir);
  delete state.tools[id];
  await saveBootstrapState(state, tuckDir);
  return state;
};

/**
 * Deterministic SHA-256 hash of a tool definition, prefixed with `sha256:`.
 *
 * Canonicalization rules:
 *   - Optional fields are coerced to `null` so `{version: "1.0"}` and
 *     `{version: undefined}` produce different hashes.
 *   - `requires` and `detect.*` arrays are sorted — those are sets
 *     semantically, so cosmetic reorders shouldn't trigger drift.
 *   - No other normalization (install/check/update are hashed verbatim;
 *     whitespace matters).
 *
 * Drift detection compares this against the `definitionHash` stored at
 * install time. A mismatch surfaces the tool as "outdated definition" in
 * the picker so the user can re-install.
 */
export const computeDefinitionHash = (tool: ToolDefinition): string => {
  const canonical = {
    id: tool.id,
    description: tool.description,
    category: tool.category ?? null,
    version: tool.version ?? null,
    requires: [...tool.requires].sort(),
    check: tool.check ?? null,
    install: tool.install,
    update: tool.update ?? null,
    detect: {
      paths: [...tool.detect.paths].sort(),
      rcReferences: [...tool.detect.rcReferences].sort(),
    },
  };
  const digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return `sha256:${digest}`;
};
