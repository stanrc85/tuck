import type { ToolDefinition } from '../../schemas/bootstrap.schema.js';
import type { BootstrapVars } from './interpolator.js';
import { resolveInstallOrder } from './resolver.js';
import { runCheck, runInstall, runUpdate, type RunOptions } from './runner.js';
import { computeDefinitionHash, recordToolInstalled } from './state.js';

/**
 * Orchestration layer between the command (UI / flag parsing) and the
 * runner (process spawning). Two stages:
 *
 *   planBootstrap   — resolve selected tool ids into an install-ordered
 *                     plan, expanding dependencies transparently.
 *   executeBootstrap — walk the plan, gating each install on `check`,
 *                      containing failures so one broken tool doesn't
 *                      abort the rest.
 *
 * Both are pure enough to test without spawning: planBootstrap takes no
 * I/O; executeBootstrap funnels all process work through `RunOptions`
 * (tests inject a fake `spawnImpl`).
 */

export interface PlanOptions {
  /** Full catalog — usually `mergeWithRegistry(config)` output. */
  catalog: ToolDefinition[];
  /** Ids the user picked (directly or via a bundle / `--all`). */
  selectedIds: string[];
}

export interface BootstrapPlan {
  /** Tools in install order including dependency closure. */
  ordered: ToolDefinition[];
  /** Ids pulled in by dep resolution that weren't in the original pick. */
  implied: string[];
  /** Ids the user asked for that aren't in the catalog. */
  unknown: string[];
}

/**
 * Resolve a selection of tool ids into an ordered plan.
 *
 * Three outputs, not just one, because the command layer wants to tell
 * the user three different things:
 *   - `unknown` — "you asked for pet but I don't know what that is"
 *   - `implied` — "to install pet I also need fzf, here's the full list"
 *   - `ordered` — "run in this order"
 *
 * Unknown ids are collected, not thrown — the command layer prompts and
 * can choose to continue with just the known ones. Catalog-internal
 * authoring errors (unknown `requires` targets, cycles) still throw via
 * the resolver because those aren't user-fixable on the fly.
 */
export const planBootstrap = (options: PlanOptions): BootstrapPlan => {
  const { catalog, selectedIds } = options;
  const byId = new Map(catalog.map((t) => [t.id, t]));

  const unknown: string[] = [];
  const directPicks = new Set<string>();
  for (const id of selectedIds) {
    if (!byId.has(id)) {
      unknown.push(id);
      continue;
    }
    directPicks.add(id);
  }

  // BFS closure — pull in every transitive `requires`.
  const closure = new Set<string>(directPicks);
  const queue: string[] = [...directPicks];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const tool = byId.get(id);
    if (!tool) continue;
    for (const req of tool.requires) {
      if (!closure.has(req) && byId.has(req)) {
        closure.add(req);
        queue.push(req);
      }
    }
  }

  const implied = [...closure].filter((id) => !directPicks.has(id));
  const selectedTools = [...closure].map((id) => byId.get(id)!);

  // Resolver still validates requires targets within the closure + catches
  // cycles. Requires targeting an id that exists in catalog but wasn't
  // pulled into the closure can't happen — we just pulled them all in.
  const order = resolveInstallOrder(selectedTools);
  const ordered = order.map((id) => byId.get(id)!);

  return { ordered, implied, unknown };
};

/** Outcome for a single tool in a bootstrap run. */
export interface ToolOutcome {
  id: string;
  status:
    | 'installed'
    | 'updated'
    | 'failed'
    | 'skipped-already-installed'
    | 'skipped-dep-failed';
  /** Present for `installed`/`updated` and `failed`. */
  exitCode?: number;
  /** Human-readable extra info (e.g. signal name) for failed outcomes. */
  detail?: string;
}

export interface ExecuteOptions {
  plan: BootstrapPlan;
  vars: Omit<BootstrapVars, 'VERSION'>;
  /** Ids whose `check` should be skipped (`--rerun <id>`). */
  force?: Set<string>;
  /** Forwarded to `runCheck` / `runInstall` / `runUpdate`. */
  runOptions?: RunOptions;
  /** Fired after each tool completes — for live progress UI. */
  onToolDone?: (outcome: ToolOutcome) => void;
  /**
   * Persist successful installs/updates to `~/.tuck/.bootstrap-state.json`.
   * Default true; set false for dry runs or tests that don't want disk
   * writes. `persist` is deliberately not gated on `runOptions.dryRun`
   * because the picker may want a "preview only" mode without dry-run
   * semantics elsewhere.
   */
  persist?: boolean;
  tuckDir?: string;
  /**
   * Which phase to run. `'install'` is the default and preserves the
   * `tuck bootstrap` semantics: run `check` first, skip-if-installed,
   * otherwise execute `tool.install`. `'update'` unconditionally runs
   * `tool.update` (or falls back to `tool.install` when `update` is
   * `@install` or omitted — see `runner.runUpdate`), never skipping
   * on `check`. The `force` set is ignored under `'update'` because
   * `check` is already bypassed.
   */
  phase?: 'install' | 'update';
}

export interface ExecuteResult {
  outcomes: ToolOutcome[];
  counts: {
    installed: number;
    updated: number;
    failed: number;
    skipped: number;
  };
}

/**
 * Walk `plan.ordered`, installing each tool. Behavior:
 *
 *   - If any `requires` failed earlier in the run, emit
 *     `skipped-dep-failed` (no check, no install).
 *   - Otherwise, if the tool has a `check` and is NOT forced, run check.
 *     Pass → `skipped-already-installed`. Fail → proceed to install.
 *   - Install. On success, optionally persist to state.
 *   - On install failure, record the id so dependents skip cleanly.
 *
 * Install failures do NOT throw — the caller gets an aggregate outcome
 * list and decides how to present it. Catalog-level errors (bash not
 * found) still bubble up from the runner.
 */
export const executeBootstrap = async (
  options: ExecuteOptions
): Promise<ExecuteResult> => {
  const {
    plan,
    vars,
    force = new Set<string>(),
    runOptions,
    onToolDone,
    persist = true,
    tuckDir,
    phase = 'install',
  } = options;

  const outcomes: ToolOutcome[] = [];
  const failedIds = new Set<string>();

  for (const tool of plan.ordered) {
    const depFailed = tool.requires.some((r) => failedIds.has(r));
    if (depFailed) {
      const outcome: ToolOutcome = { id: tool.id, status: 'skipped-dep-failed' };
      outcomes.push(outcome);
      onToolDone?.(outcome);
      continue;
    }

    const toolVars: BootstrapVars = { ...vars, VERSION: tool.version };

    // `check` gating only applies to install — update intentionally re-runs
    // even when the tool is already present (upgrading is the whole point).
    if (phase === 'install' && !force.has(tool.id) && tool.check) {
      const installed = await runCheck(tool, toolVars, runOptions);
      if (installed) {
        const outcome: ToolOutcome = { id: tool.id, status: 'skipped-already-installed' };
        outcomes.push(outcome);
        onToolDone?.(outcome);
        continue;
      }
    }

    const result =
      phase === 'update'
        ? await runUpdate(tool, toolVars, runOptions)
        : await runInstall(tool, toolVars, runOptions);
    if (result.ok) {
      const status: ToolOutcome['status'] = phase === 'update' ? 'updated' : 'installed';
      const outcome: ToolOutcome = {
        id: tool.id,
        status,
        exitCode: result.exitCode ?? 0,
      };
      if (persist) {
        await recordToolInstalled(tool.id, computeDefinitionHash(tool), {
          ...(tool.version !== undefined ? { version: tool.version } : {}),
          ...(tuckDir !== undefined ? { tuckDir } : {}),
        });
      }
      outcomes.push(outcome);
      onToolDone?.(outcome);
    } else {
      failedIds.add(tool.id);
      const outcome: ToolOutcome = {
        id: tool.id,
        status: 'failed',
        ...(result.exitCode !== null ? { exitCode: result.exitCode } : {}),
        ...(result.signal ? { detail: `terminated by ${result.signal}` } : {}),
      };
      outcomes.push(outcome);
      onToolDone?.(outcome);
    }
  }

  return {
    outcomes,
    counts: {
      installed: outcomes.filter((o) => o.status === 'installed').length,
      updated: outcomes.filter((o) => o.status === 'updated').length,
      failed: outcomes.filter((o) => o.status === 'failed').length,
      skipped: outcomes.filter((o) => o.status.startsWith('skipped')).length,
    },
  };
};
