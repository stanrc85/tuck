import { Command } from 'commander';
import { join } from 'path';
import { prompts, isInteractive } from '../ui/index.js';
import { getTuckDir, pathExists } from '../lib/paths.js';
import { loadBootstrapConfig, emptyBootstrapConfig } from '../lib/bootstrap/parser.js';
import { detectPlatformVars } from '../lib/bootstrap/interpolator.js';
import {
  executeBootstrap,
  type ToolOutcome,
  type BootstrapPlan,
} from '../lib/bootstrap/orchestrator.js';
import {
  loadBootstrapState,
  computeDefinitionHash,
  type BootstrapState,
  type ToolStateEntry,
} from '../lib/bootstrap/state.js';
import { resolveInstallOrder } from '../lib/bootstrap/resolver.js';
import type { ToolDefinition } from '../schemas/bootstrap.schema.js';
import { BootstrapError, NonInteractivePromptError } from '../errors.js';
import { compareVersions } from '../lib/updater.js';

export interface BootstrapUpdateOptions {
  /** Override location of `bootstrap.toml`. Defaults to `<tuckDir>/bootstrap.toml`. */
  file?: string;
  /** Update every installed tool, skip picker. */
  all?: boolean;
  /** Comma- or space-separated tool ids. Skips the picker. */
  tools?: string;
  /** Report tools with pending updates without doing anything. Exit 1 if any pending. */
  check?: boolean;
  /** Print the plan without executing. */
  dryRun?: boolean;
  /** Skip confirmation prompts and enable sudo pre-check. */
  yes?: boolean;
}

export interface RunBootstrapUpdateResult {
  plan: BootstrapPlan | null;
  counts: { updated: number; failed: number; skipped: number } | null;
  dryRun: boolean;
  /** Populated under `--check`. */
  pending?: PendingUpdate[];
}

/**
 * A tool present in state whose catalog definition has changed since the
 * recorded install. Two independent signals:
 *
 *   versionBump — catalog `version` > state `version` (semver-compare).
 *   hashDrift   — catalog `computeDefinitionHash` != state `definitionHash`.
 *
 * Either (or both) flips `hasPendingUpdate`. A tool absent from the catalog
 * but present in state is reported as `orphaned` and skipped — update
 * doesn't know what script to run without the definition.
 */
export interface PendingUpdate {
  id: string;
  installedVersion?: string;
  catalogVersion?: string;
  versionBump: boolean;
  hashDrift: boolean;
  orphaned: boolean;
}

export const bootstrapUpdateCommand = new Command('update')
  .description('Update tools previously installed via tuck bootstrap')
  .option('-f, --file <path>', 'Path to bootstrap.toml (default: <tuckDir>/bootstrap.toml)')
  .option('--all', 'Update every installed tool (skip picker)')
  .option('--tools <ids>', 'Comma-separated tool ids to update (skip picker)')
  .option('--check', 'Report pending updates without running them (exit 1 if any)')
  .option('--dry-run', 'Print the plan without executing')
  .option('-y, --yes', 'Skip confirmations and enable sudo pre-check under --yes')
  .action(async (options: BootstrapUpdateOptions) => {
    await runBootstrapUpdate(options);
  });

/**
 * Shared entry point for the command action and tests. Loads state +
 * catalog, computes pending updates, and either reports (`--check`) or
 * runs the update phase through `executeBootstrap`.
 */
export const runBootstrapUpdate = async (
  options: BootstrapUpdateOptions = {}
): Promise<RunBootstrapUpdateResult> => {
  const tuckDir = getTuckDir();
  const explicitFile = options.file !== undefined;
  const configPath = options.file ?? join(tuckDir, 'bootstrap.toml');

  prompts.intro('tuck bootstrap update');

  let config;
  if (!explicitFile && !(await pathExists(configPath))) {
    config = emptyBootstrapConfig();
  } else {
    config = await loadBootstrapConfig(configPath);
  }
  const catalog = config.tool;
  const byId = new Map(catalog.map((t) => [t.id, t]));

  const state = await loadBootstrapState(tuckDir);
  const installedIds = Object.keys(state.tools);

  if (installedIds.length === 0) {
    prompts.log.info('No tools have been installed via `tuck bootstrap` yet.');
    prompts.outro('Nothing to update');
    return { plan: null, counts: null, dryRun: false };
  }

  const pending = computePendingUpdates(state, catalog);

  if (options.check) {
    reportPending(pending);
    // System-managed tools are not tuck's problem — exclude them from
    // both the "pending" exit-code signal and the returned payload so
    // `tuck bootstrap update --check` doesn't flag apt-owned drift.
    const actionable = pending.filter((p) => p.excludeReason === null);
    const anyPending = actionable.some((p) => p.hasPendingUpdate);
    // Non-zero exit so `tuck bootstrap update --check` is scriptable the
    // same way `tuck self-update --check` is.
    process.exitCode = anyPending ? 1 : 0;
    prompts.outro(anyPending ? 'Run `tuck bootstrap update` to apply.' : 'All tools are up to date.');
    return {
      plan: null,
      counts: null,
      dryRun: false,
      pending: actionable.filter((p) => p.hasPendingUpdate).map(stripInternal),
    };
  }

  // Select which tools to update.
  const selectedIds = await determineUpdateSelection(options, pending, installedIds);
  if (selectedIds.length === 0) {
    prompts.outro('Nothing selected');
    return { plan: null, counts: null, dryRun: false };
  }

  // Filter out ids that either aren't in state (can't update something we
  // never installed) or aren't in the catalog (orphaned).
  const skippedNotInstalled: string[] = [];
  const skippedOrphaned: string[] = [];
  const resolvable: ToolDefinition[] = [];
  for (const id of selectedIds) {
    if (!state.tools[id]) {
      skippedNotInstalled.push(id);
      continue;
    }
    const tool = byId.get(id);
    if (!tool) {
      skippedOrphaned.push(id);
      continue;
    }
    resolvable.push(tool);
  }

  if (skippedNotInstalled.length > 0) {
    prompts.log.warning(
      `Skipping not-installed tool(s): ${skippedNotInstalled.join(', ')}`
    );
  }
  if (skippedOrphaned.length > 0) {
    prompts.log.warning(
      `Skipping orphaned tool(s) (present in state, missing from catalog): ${skippedOrphaned.join(', ')}`
    );
  }
  if (resolvable.length === 0) {
    prompts.outro('Nothing to update');
    return { plan: null, counts: null, dryRun: false };
  }

  // Topo-sort within the selection. Requires targeting tools outside the
  // selection are dropped — update doesn't expand the closure the way
  // install does, because updating dependents doesn't require their deps
  // to also be re-updated (install scripts are idempotent).
  const selectionSet = new Set(resolvable.map((t) => t.id));
  const stripped = resolvable.map((t) => ({
    ...t,
    requires: t.requires.filter((r) => selectionSet.has(r)),
  }));
  const order = resolveInstallOrder(stripped);
  const ordered = order.map((id) => resolvable.find((t) => t.id === id)!);

  const plan: BootstrapPlan = {
    ordered,
    implied: [],
    unknown: [],
  };

  prompts.log.info(`${ordered.length} tool(s) to update: ${ordered.map((t) => t.id).join(', ')}`);

  if (options.dryRun) {
    for (let i = 0; i < ordered.length; i++) {
      prompts.log.message(`  ${i + 1}. ${ordered[i]!.id}`);
    }
    prompts.outro('Dry run — no tools were updated');
    return { plan, counts: null, dryRun: true };
  }

  const vars = detectPlatformVars();
  const result = await executeBootstrap({
    plan,
    vars,
    runOptions: { autoYes: options.yes === true },
    onToolDone: (o) => logUpdateOutcome(o),
    tuckDir,
    phase: 'update',
  });

  printUpdateSummary(result.outcomes, result.counts);
  if (result.counts.failed > 0) {
    throw new BootstrapError(
      `${result.counts.failed} tool(s) failed to update`,
      ['Review the output above', 'Re-run `tuck bootstrap update` after fixing the underlying issue']
    );
  }
  prompts.outro('Update complete');
  return {
    plan,
    counts: {
      updated: result.counts.updated,
      failed: result.counts.failed,
      skipped: result.counts.skipped,
    },
    dryRun: false,
  };
};

const determineUpdateSelection = async (
  options: BootstrapUpdateOptions,
  pending: EnrichedPending[],
  installedIds: string[]
): Promise<string[]> => {
  const excludedById = new Map(
    pending
      .filter((p) => p.excludeReason !== null)
      .map((p) => [p.id, p.excludeReason as 'system' | 'manual'])
  );
  if (options.all) {
    // --all obeys the updateVia filter — users running `tuck update --all`
    // don't want apt/manual-managed tools running their update scripts on
    // every refresh. Surfacing the deferred set lets them see WHY those
    // tools aren't in the plan.
    const filtered = installedIds.filter((id) => !excludedById.has(id));
    const deferred = installedIds
      .filter((id) => excludedById.has(id))
      .map((id) => ({ id, reason: excludedById.get(id)! }));
    logDeferredPicks(deferred);
    return filtered;
  }
  if (options.tools) {
    // Explicit --tools is the escape hatch — if the user names a
    // system-managed tool by id, honour it without filtering.
    return parseIdList(options.tools);
  }
  return runUpdatePicker(pending);
};

const runUpdatePicker = async (pending: EnrichedPending[]): Promise<string[]> => {
  if (!isInteractive()) {
    throw new NonInteractivePromptError('tuck bootstrap update', [
      'Pass --all to update every installed tool',
      'Or --tools id1,id2 for an explicit list',
      'Or --check to see which tools have pending updates',
    ]);
  }

  // Surface pending-update tools first so the default multiselect focus is
  // useful. Orphaned entries aren't offered — we can't update a tool whose
  // definition isn't in the catalog anymore. Excluded tools (system- or
  // manually-managed) are also filtered out; if any were dropped we log
  // them so the user isn't confused about missing entries.
  const deferred = pending
    .filter((p) => p.excludeReason !== null && !p.orphaned)
    .map((p) => ({ id: p.id, reason: p.excludeReason as 'system' | 'manual' }));
  logDeferredPicks(deferred);
  const selectable = pending.filter((p) => !p.orphaned && p.excludeReason === null);
  if (selectable.length === 0) {
    prompts.log.warning('No installed tools have definitions in the current catalog.');
    return [];
  }

  const sorted = [
    ...selectable.filter((p) => p.hasPendingUpdate),
    ...selectable.filter((p) => !p.hasPendingUpdate),
  ];

  const pickerOptions = sorted.map((p) => ({
    value: p.id,
    label: `${p.id}${pendingTagSuffix(p)}`,
    hint: formatPendingHint(p),
  }));

  // Pre-check pending-update tools so the common case ("update the things
  // that need it") is one keypress.
  const initialValues = sorted.filter((p) => p.hasPendingUpdate).map((p) => p.id);

  const picked = await prompts.multiselect<string>('Select tools to update:', pickerOptions, {
    initialValues,
  });

  return picked;
};

interface EnrichedPending extends PendingUpdate {
  /** Convenience: `versionBump || hashDrift`. Not persisted. */
  hasPendingUpdate: boolean;
  /**
   * When set, the tool is excluded from the default-flow update scopes
   * (`--all`, picker, `--check`). `--tools <id>` still honors the request
   * as an explicit escape hatch.
   *   `'system'` — `updateVia: 'system'`; deferred to apt/dnf/brew/...
   *   `'manual'` — `updateVia: 'manual'`; user refreshes manually when
   *               they want it (curl-from-GitHub fonts, cache rebuilds).
   *   `null`     — included in default-flow updates.
   */
  excludeReason: 'system' | 'manual' | null;
}

const stripInternal = (p: EnrichedPending): PendingUpdate => {
  const { hasPendingUpdate: _a, excludeReason: _b, ...rest } = p;
  void _a;
  void _b;
  return rest;
};

const computePendingUpdates = (
  state: BootstrapState,
  catalog: ToolDefinition[]
): EnrichedPending[] => {
  const byId = new Map(catalog.map((t) => [t.id, t]));
  const out: EnrichedPending[] = [];
  for (const [id, entry] of Object.entries(state.tools)) {
    const tool = byId.get(id);
    if (!tool) {
      out.push({
        id,
        ...(entry.version !== undefined ? { installedVersion: entry.version } : {}),
        versionBump: false,
        hashDrift: false,
        orphaned: true,
        hasPendingUpdate: false,
        excludeReason: null,
      });
      continue;
    }
    const versionBump = isVersionBump(entry, tool);
    const hashDrift = computeDefinitionHash(tool) !== entry.definitionHash;
    out.push({
      id,
      ...(entry.version !== undefined ? { installedVersion: entry.version } : {}),
      ...(tool.version !== undefined ? { catalogVersion: tool.version } : {}),
      versionBump,
      hashDrift,
      orphaned: false,
      hasPendingUpdate: versionBump || hashDrift,
      excludeReason:
        tool.updateVia === 'system'
          ? 'system'
          : tool.updateVia === 'manual'
            ? 'manual'
            : null,
    });
  }
  return out;
};

const isVersionBump = (state: ToolStateEntry, tool: ToolDefinition): boolean => {
  // Tool has no version in catalog → nothing to compare.
  if (tool.version === undefined) return false;
  // State has no version but catalog does → treat as a bump so we don't
  // silently miss an upgrade for a tool that gained version-pinning between
  // installs.
  if (state.version === undefined) return true;
  try {
    return compareVersions(state.version, tool.version) < 0;
  } catch {
    // Non-semver version strings (e.g. date pins) — fall back to string
    // inequality as a coarse drift signal.
    return state.version !== tool.version;
  }
};

const pendingTagSuffix = (p: EnrichedPending): string => {
  if (p.hasPendingUpdate) {
    const bits: string[] = [];
    if (p.versionBump) {
      bits.push(`${p.installedVersion ?? '?'} → ${p.catalogVersion ?? '?'}`);
    } else if (p.hashDrift) {
      bits.push('definition changed');
    }
    return ` [${bits.join(', ')}]`;
  }
  return '';
};

const formatPendingHint = (p: EnrichedPending): string => {
  if (p.orphaned) return 'orphaned — definition missing from catalog';
  if (p.hasPendingUpdate) return 'pending update';
  return 'up to date';
};

/**
 * Log the tools we're skipping under the default `tuck bootstrap update`
 * scopes, branching the message by `updateVia` reason. Pre-v3.2 we only
 * had `'system'`, so the single message ("Deferred to system package
 * manager: ...") was correct. Now we split:
 *
 *   - 'system' → "Deferred to system package manager: <ids>"
 *     (apt/dnf/brew owns the update path, run that instead)
 *   - 'manual' → "Manually managed: <ids> (run `tuck bootstrap update
 *               --tools <id>` to refresh)"
 *     (no package manager involved; user invokes manually when wanted)
 *
 * Both groups are logged when present. Empty input is a no-op.
 */
const logDeferredPicks = (
  deferred: readonly { id: string; reason: 'system' | 'manual' }[]
): void => {
  if (deferred.length === 0) return;
  const systemIds = deferred.filter((d) => d.reason === 'system').map((d) => d.id);
  const manualIds = deferred.filter((d) => d.reason === 'manual').map((d) => d.id);
  if (systemIds.length > 0) {
    prompts.log.info(
      `Deferred to system package manager: ${systemIds.join(', ')}`
    );
  }
  if (manualIds.length > 0) {
    prompts.log.info(
      `Manually managed: ${manualIds.join(', ')} (run \`tuck bootstrap update --tools <id>\` to refresh)`
    );
  }
};

const reportPending = (pending: EnrichedPending[]): void => {
  // Excluded tools (system- or manually-managed) are filtered from the drift
  // signal — they have their own update path, and tuck reporting "pending"
  // for them would drive scripted users to run `tuck update` needlessly.
  const actionable = pending.filter((p) => p.excludeReason === null);
  const pendingOnly = actionable.filter((p) => p.hasPendingUpdate);
  const orphaned = actionable.filter((p) => p.orphaned);
  const deferred = pending
    .filter((p) => p.excludeReason !== null)
    .map((p) => ({ id: p.id, reason: p.excludeReason as 'system' | 'manual' }));

  if (pendingOnly.length === 0) {
    prompts.log.success('All installed tools are up to date.');
  } else {
    prompts.log.info(`${pendingOnly.length} tool(s) with pending updates:`);
    for (const p of pendingOnly) {
      const tag = p.versionBump
        ? `${p.installedVersion ?? '?'} → ${p.catalogVersion ?? '?'}`
        : 'definition changed';
      prompts.log.message(`  • ${p.id} (${tag})`);
    }
  }

  logDeferredPicks(deferred);

  if (orphaned.length > 0) {
    prompts.log.warning(
      `${orphaned.length} orphaned tool(s) in state without a catalog definition: ${orphaned
        .map((p) => p.id)
        .join(', ')}`
    );
  }
};

const logUpdateOutcome = (outcome: ToolOutcome): void => {
  switch (outcome.status) {
    case 'updated':
      prompts.log.success(`updated ${outcome.id}`);
      break;
    case 'installed':
      // `runUpdate` falls back to `install` when `update` is omitted or
      // `@install` — we report those as `installed` here for clarity.
      prompts.log.success(`re-ran install for ${outcome.id}`);
      break;
    case 'skipped-dep-failed':
      prompts.log.warning(`${outcome.id} skipped (dependency failed)`);
      break;
    case 'failed': {
      const detail = outcome.detail ? outcome.detail : `exit ${outcome.exitCode ?? 'unknown'}`;
      prompts.log.error(`${outcome.id} failed (${detail})`);
      break;
    }
    case 'skipped-already-installed':
      // shouldn't happen under phase='update' but fall through benignly.
      prompts.log.info(`${outcome.id} skipped`);
      break;
  }
};

const printUpdateSummary = (
  outcomes: ToolOutcome[],
  counts: { installed: number; updated: number; failed: number; skipped: number }
): void => {
  const updated = outcomes.filter((o) => o.status === 'updated').map((o) => o.id);
  const failed = outcomes.filter((o) => o.status === 'failed').map((o) => o.id);
  const skipped = outcomes.filter((o) => o.status.startsWith('skipped')).map((o) => o.id);

  const lines: string[] = [
    `updated: ${counts.updated}${updated.length > 0 ? ` (${updated.join(', ')})` : ''}`,
    `skipped: ${counts.skipped}${skipped.length > 0 ? ` (${skipped.join(', ')})` : ''}`,
    `failed:  ${counts.failed}${failed.length > 0 ? ` (${failed.join(', ')})` : ''}`,
  ];
  prompts.log.message(lines.join('\n'));
};

const parseIdList = (raw?: string): string[] => {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};
