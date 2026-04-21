import { Command } from 'commander';
import { basename, join } from 'path';
import { spawn } from 'child_process';
import { prompts, isInteractive } from '../ui/index.js';
import { getTuckDir, pathExists } from '../lib/paths.js';
import { loadBootstrapConfig } from '../lib/bootstrap/parser.js';
import { bootstrapConfigSchema } from '../schemas/bootstrap.schema.js';
import { mergeWithRegistry } from '../lib/bootstrap/registry/index.js';
import { detectTool } from '../lib/bootstrap/detect.js';
import {
  detectPlatformVars,
  type BootstrapVars,
} from '../lib/bootstrap/interpolator.js';
import {
  planBootstrap,
  executeBootstrap,
  type ToolOutcome,
  type BootstrapPlan,
} from '../lib/bootstrap/orchestrator.js';
import { loadBootstrapState } from '../lib/bootstrap/state.js';
import { runCheck } from '../lib/bootstrap/runner.js';
import type { BootstrapConfig, ToolDefinition } from '../schemas/bootstrap.schema.js';
import { BootstrapError, NonInteractivePromptError } from '../errors.js';
import { bootstrapUpdateCommand } from './bootstrap-update.js';
import { bundleCommand } from './bootstrap-bundle.js';

export interface BootstrapOptions {
  /** Override location of `bootstrap.toml`. Defaults to `<tuckDir>/bootstrap.toml`. */
  file?: string;
  /** Install every tool in the (merged) catalog. Skips the picker. */
  all?: boolean;
  /** Install the named bundle. Skips the picker. */
  bundle?: string;
  /** Comma- or space-separated tool ids. Skips the picker. */
  tools?: string;
  /** Comma- or space-separated tool ids to force-reinstall (ignore `check`). */
  rerun?: string;
  /** Print the plan without executing. */
  dryRun?: boolean;
  /** Skip confirmation prompts and enable sudo pre-check. */
  yes?: boolean;
  /** In the picker, show a flat alphabetical list and ignore detection signals. */
  noDetect?: boolean;
}

export const bootstrapCommand = new Command('bootstrap')
  .description('Install tools declared in your bootstrap.toml')
  .option('-f, --file <path>', 'Path to bootstrap.toml (default: <tuckDir>/bootstrap.toml)')
  .option('--all', 'Install every tool in the catalog (skip picker)')
  .option('--bundle <name>', 'Install a named bundle (skip picker)')
  .option('--tools <ids>', 'Comma-separated tool ids to install (skip picker)')
  .option('--rerun <ids>', 'Comma-separated tool ids to force-reinstall (bypass check)')
  .option('--dry-run', 'Print the planned tools without executing')
  .option('-y, --yes', 'Skip confirmations and enable sudo pre-check under --yes')
  .option('--no-detect', 'In the picker, ignore detection signals and show a flat list')
  .action(async (options: BootstrapOptions) => {
    await runBootstrap(options);
  })
  .addCommand(bootstrapUpdateCommand)
  .addCommand(bundleCommand);

/**
 * Shape returned from `runBootstrap`. Tests inspect `plan` (dry-run) or
 * `counts` (executed). `null` counts mean the run exited before reaching
 * execute — empty catalog, nothing selected, dry-run.
 */
export interface RunBootstrapResult {
  plan: BootstrapPlan | null;
  counts: { installed: number; failed: number; skipped: number } | null;
  dryRun: boolean;
}

/**
 * Entry point shared by the command action and tests. Keeps commander
 * out of the test surface so integration tests can pass a plain options
 * object without argv plumbing.
 */
export const runBootstrap = async (
  options: BootstrapOptions = {}
): Promise<RunBootstrapResult> => {
  const tuckDir = getTuckDir();
  const explicitFile = options.file !== undefined;
  const configPath = options.file ?? join(tuckDir, 'bootstrap.toml');

  prompts.intro('tuck bootstrap');

  // bootstrap.toml is optional: absent at the default location → run with
  // just the built-in registry (so users who only want fzf/eza/pet/etc.
  // don't need to hand-create an empty file). An explicit `--file` that
  // points at a missing path is a user typo — still errors loudly.
  let config;
  if (!explicitFile && !(await pathExists(configPath))) {
    config = bootstrapConfigSchema.parse({});
  } else {
    config = await loadBootstrapConfig(configPath);
  }
  const catalog = mergeWithRegistry(config);

  if (catalog.length === 0) {
    prompts.log.warning('No tools defined in bootstrap.toml (and no built-ins).');
    prompts.outro('Nothing to do');
    return { plan: null, counts: null, dryRun: false };
  }

  const selectedIds = await determineSelection(config, catalog, options);
  if (selectedIds.length === 0) {
    prompts.outro('Nothing selected');
    return { plan: null, counts: null, dryRun: false };
  }

  const plan = planBootstrap({ catalog, selectedIds });
  reportPlanMetadata(plan);

  if (options.dryRun) {
    printDryRun(plan);
    prompts.outro('Dry run — no tools were installed');
    return { plan, counts: null, dryRun: true };
  }

  const vars = detectPlatformVars();
  const force = parseIdList(options.rerun);

  const outcomes = await executeBootstrap({
    plan,
    vars,
    force: new Set(force),
    runOptions: {
      autoYes: options.yes === true,
    },
    onToolDone: (o) => logToolOutcome(o),
    tuckDir,
  });

  printSummary(outcomes.outcomes, outcomes.counts);
  if (outcomes.counts.failed > 0) {
    // Non-zero exit so CI pipelines see the failure without having to
    // parse the summary. Leave process.exit to the outer error handler.
    throw new BootstrapError(
      `${outcomes.counts.failed} tool(s) failed to install`,
      ['Review the output above', 'Re-run `tuck bootstrap` after fixing the underlying issue']
    );
  }
  await maybePromptForShellChange();
  prompts.outro('Bootstrap complete');
  return { plan, counts: outcomes.counts, dryRun: false };
};

export interface ShellChangePromptDeps {
  spawnImpl?: typeof spawn;
  envShell?: string;
  platform?: NodeJS.Platform;
  interactive?: boolean;
}

/**
 * After a successful bootstrap, offer to swap the user's login shell to
 * zsh when zsh is installed but the active `$SHELL` points elsewhere. No-op
 * on Windows, non-TTY runs, or when zsh is already the login shell. The
 * chsh subprocess uses inherited stdio so PAM password prompts land on the
 * user's real TTY.
 */
export const maybePromptForShellChange = async (
  deps: ShellChangePromptDeps = {}
): Promise<void> => {
  const platform = deps.platform ?? process.platform;
  if (platform === 'win32') return;

  const interactive = deps.interactive ?? isInteractive();
  if (!interactive) return;

  const envShell = deps.envShell ?? process.env.SHELL ?? '';
  if (envShell === 'zsh' || envShell.endsWith('/zsh')) return;

  const spawnImpl = deps.spawnImpl ?? spawn;

  const zshPath = await locateZsh(spawnImpl);
  if (!zshPath) return;

  const currentName = envShell ? basename(envShell) : 'your shell';
  const confirmed = await prompts.confirm(
    `zsh is installed but your login shell is ${currentName}. Set zsh as your default shell?`,
    true
  );
  if (!confirmed) return;

  const ok = await runChsh(spawnImpl, zshPath);
  if (ok) {
    prompts.log.success('Default shell changed to zsh. Log out and back in to apply.');
  } else {
    prompts.log.warning(`chsh did not complete. Run manually: chsh -s ${zshPath}`);
  }
};

const locateZsh = (spawnImpl: typeof spawn): Promise<string> => {
  return new Promise((resolve) => {
    try {
      const child = spawnImpl('which', ['zsh'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.on('error', () => resolve(''));
      child.on('exit', (code) => resolve(code === 0 ? stdout.trim() : ''));
    } catch {
      resolve('');
    }
  });
};

const runChsh = (spawnImpl: typeof spawn, zshPath: string): Promise<boolean> => {
  return new Promise((resolve) => {
    try {
      // Inherited stdio so chsh can prompt for a password on the user's TTY.
      const child = spawnImpl('chsh', ['-s', zshPath], { stdio: 'inherit' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
};

const determineSelection = async (
  config: BootstrapConfig,
  catalog: ToolDefinition[],
  options: BootstrapOptions
): Promise<string[]> => {
  if (options.all) {
    return catalog.map((t) => t.id);
  }

  if (options.bundle) {
    const members = config.bundles[options.bundle];
    if (!members) {
      throw new BootstrapError(`Unknown bundle "${options.bundle}"`, [
        `Available bundles: ${Object.keys(config.bundles).join(', ') || '(none)'}`,
      ]);
    }
    return [...members];
  }

  if (options.tools) {
    return parseIdList(options.tools);
  }

  return runPicker(catalog, options);
};

const runPicker = async (
  catalog: ToolDefinition[],
  options: BootstrapOptions
): Promise<string[]> => {
  if (!isInteractive()) {
    throw new NonInteractivePromptError('tuck bootstrap', [
      'Pass --all to install every tool in the catalog',
      'Or --bundle <name> for a named bundle',
      'Or --tools id1,id2 for an explicit list',
    ]);
  }

  const state = await loadBootstrapState(getTuckDir());
  const vars = detectPlatformVars();

  // Prime UI with detection + check info. Both are side-effect-free from the
  // user's perspective — detection is disk reads, check spawns quick probes
  // that bash-up fast enough to keep the picker responsive.
  const enriched = await Promise.all(
    catalog.map(async (t) => {
      const detection = options.noDetect
        ? { detected: false, reasons: [] as never[] }
        : await detectTool(t).catch(() => ({ detected: false, reasons: [] as never[] }));
      const toolVars: BootstrapVars = { ...vars, VERSION: t.version };
      const installed =
        t.check !== undefined
          ? await runCheck(t, toolVars, { log: () => {} }).catch(() => false)
          : state.tools[t.id] !== undefined;
      return { tool: t, detected: detection.detected, reasons: detection.reasons, installed };
    })
  );

  // Sort: detected first (in input order), then the rest. `--no-detect`
  // produces the ticket's "flat alphabetical" mode instead.
  const sorted = options.noDetect
    ? [...enriched].sort((a, b) => a.tool.id.localeCompare(b.tool.id))
    : [
        ...enriched.filter((e) => e.detected),
        ...enriched.filter((e) => !e.detected),
      ];

  const pickerOptions = sorted.map((e) => ({
    value: e.tool.id,
    label: formatPickerLabel(e),
    hint: e.tool.description,
  }));

  const initialValues = options.noDetect
    ? []
    : sorted.filter((e) => e.detected).map((e) => e.tool.id);

  const picked = await prompts.multiselect<string>('Select tools to install:', pickerOptions, {
    initialValues,
  });

  return picked;
};

const formatPickerLabel = (entry: {
  tool: ToolDefinition;
  detected: boolean;
  reasons: ReadonlyArray<{ kind: string }>;
  installed: boolean;
}): string => {
  const tags: string[] = [];
  if (entry.detected) tags.push('detected');
  if (entry.installed) tags.push('installed');
  const suffix = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
  return `${entry.tool.id}${suffix}`;
};

const reportPlanMetadata = (plan: BootstrapPlan): void => {
  if (plan.unknown.length > 0) {
    prompts.log.warning(`Skipping unknown tool(s): ${plan.unknown.join(', ')}`);
  }
  if (plan.implied.length > 0) {
    prompts.log.info(`Auto-including required dependencies: ${plan.implied.join(', ')}`);
  }
};

const printDryRun = (plan: BootstrapPlan): void => {
  prompts.log.info(`Planned install order (${plan.ordered.length} tool(s)):`);
  for (let i = 0; i < plan.ordered.length; i++) {
    const tool = plan.ordered[i]!;
    const isImplied = plan.implied.includes(tool.id);
    prompts.log.message(`  ${i + 1}. ${tool.id}${isImplied ? ' (dep)' : ''}`);
  }
};

const logToolOutcome = (outcome: ToolOutcome): void => {
  switch (outcome.status) {
    case 'installed':
      prompts.log.success(`installed ${outcome.id}`);
      break;
    case 'skipped-already-installed':
      prompts.log.info(`${outcome.id} already installed — skipped`);
      break;
    case 'skipped-dep-failed':
      prompts.log.warning(`${outcome.id} skipped (dependency failed)`);
      break;
    case 'failed': {
      const detail = outcome.detail
        ? outcome.detail
        : `exit ${outcome.exitCode ?? 'unknown'}`;
      prompts.log.error(`${outcome.id} failed (${detail})`);
      break;
    }
  }
};

const printSummary = (
  outcomes: ToolOutcome[],
  counts: { installed: number; failed: number; skipped: number }
): void => {
  const installed = outcomes.filter((o) => o.status === 'installed').map((o) => o.id);
  const failed = outcomes.filter((o) => o.status === 'failed').map((o) => o.id);
  const skipped = outcomes.filter((o) => o.status.startsWith('skipped')).map((o) => o.id);

  const lines: string[] = [
    `installed: ${counts.installed}${installed.length > 0 ? ` (${installed.join(', ')})` : ''}`,
    `skipped:   ${counts.skipped}${skipped.length > 0 ? ` (${skipped.join(', ')})` : ''}`,
    `failed:    ${counts.failed}${failed.length > 0 ? ` (${failed.join(', ')})` : ''}`,
  ];
  prompts.log.message(lines.join('\n'));
};

/**
 * Split a user-supplied list — accepts commas, spaces, or both. Empty
 * tokens are dropped so trailing commas don't produce "" entries.
 */
const parseIdList = (raw?: string): string[] => {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};
