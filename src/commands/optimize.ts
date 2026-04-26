import { Command } from 'commander';
import { readFile, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { homedir } from 'os';
import { prompts, logger, colors as c } from '../ui/index.js';
import { pathExists } from '../lib/paths.js';
import {
  runShellProfile,
  parseXtrace,
  applyRules,
  type ProfileReport,
  type ProfileShell,
  type Recommendation,
  type SourceMap,
} from '../lib/shellProfiler/index.js';
import { createSnapshot } from '../lib/timemachine.js';

interface OptimizeOptions {
  profile?: boolean;
  auto?: boolean;
  yes?: boolean;
  format?: 'text' | 'json';
  shell?: string;
}

// Pick the shell to profile. Explicit `--shell <bash|zsh>` wins. Otherwise
// inspect $SHELL — every Unix login shell has it set to the user's chosen
// interactive shell. Falls back to zsh if $SHELL is unset or unrecognised
// (matches the v1 default and the common case on macOS / modern Linux).
// Exported for unit tests — the dispatch decision is the part worth pinning.
export const resolveProfileShell = (
  override: string | undefined,
  envShellPath?: string,
): ProfileShell => {
  if (override) {
    if (override === 'zsh' || override === 'bash') return override;
    throw new Error(`Unsupported --shell value: ${override}. Expected "zsh" or "bash".`);
  }
  const source = envShellPath ?? process.env.SHELL ?? '';
  const envShell = source ? basename(source) : '';
  if (envShell === 'bash') return 'bash';
  return 'zsh';
};

const isInteractive = (): boolean => Boolean(process.stdout.isTTY);

// Read the common shell startup files so rules can inspect literal lines
// (duplicate PATH detection, for instance, can't be done from xtrace alone).
// Files that don't exist are just omitted — rules treat absence as "no evidence."
const SHELL_SOURCE_CANDIDATES: Record<ProfileShell, string[]> = {
  zsh: ['.zshenv', '.zprofile', '.zshrc', '.zlogin'],
  bash: ['.bashrc', '.bash_profile', '.profile', '.bash_login'],
};

const readShellSources = async (shell: ProfileShell): Promise<SourceMap> => {
  const home = homedir();
  const sources: SourceMap = {};
  for (const name of SHELL_SOURCE_CANDIDATES[shell]) {
    const path = join(home, name);
    if (!(await pathExists(path))) continue;
    try {
      sources[path] = await readFile(path, 'utf-8');
      // Also key by basename — PS4 `%N` / `${BASH_SOURCE}` sometimes records
      // the filename without the full path depending on how the file was
      // sourced. Try both so rules that correlate events to sources hit
      // either form.
      sources[name] = sources[path];
    } catch {
      // Ignore unreadable files; rules simply get less evidence.
    }
  }
  return sources;
};

const formatMs = (ms: number): string => {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const printProfileReport = (report: ProfileReport): void => {
  console.log(c.bold('Shell startup profile'));
  console.log(c.dim(`  Total instrumented time: ${formatMs(report.totalMs)}`));
  console.log(c.dim(`  Events: ${report.events.length}`));
  console.log();

  if (report.perFile.length === 0) {
    logger.warning('No events parsed — is zsh configured and does it run to completion?');
    return;
  }

  console.log(c.bold('Top files by wall-clock time:'));
  const top = report.perFile.slice(0, 10);
  const maxLen = Math.max(...top.map((f) => f.file.length));
  const pathWidth = Math.min(maxLen, 50);
  for (const f of top) {
    const pct = report.totalMs > 0 ? (f.totalMs / report.totalMs) * 100 : 0;
    const path = f.file.length > pathWidth
      ? '...' + f.file.slice(-(pathWidth - 3))
      : f.file.padEnd(pathWidth);
    console.log(
      `  ${path}  ${formatMs(f.totalMs).padStart(8)}  ${c.dim(`${pct.toFixed(1)}% (${f.eventCount} events)`)}`,
    );
  }
  console.log();
};

const printRecommendations = (recs: Recommendation[]): void => {
  if (recs.length === 0) {
    logger.success('No advisory issues detected.');
    return;
  }

  console.log(c.bold(`Recommendations (${recs.length}):`));
  console.log();
  for (const r of recs) {
    const badge = r.severity === 'warn' ? c.yellow('warn') : c.cyan('info');
    console.log(`  ${badge}  ${c.bold(r.rule)}`);
    console.log(`         ${r.message}`);
    console.log(`         ${c.dim('→ ' + r.suggestion)}`);
    if (r.evidence.length > 0) {
      console.log(c.dim('         Evidence:'));
      for (const line of r.evidence) {
        console.log(c.dim(`           ${line}`));
      }
    }
    console.log();
  }
};

interface AutoFix {
  rule: string;
  targetPath: string;
  before: string;
  after: string;
  summary: string;
}

// Build the set of safe auto-fixes. v1 ships only one: append
// `skip_global_compinit=1` to ~/.zshenv when `multiple-compinit` fires and
// the line isn't already present. PATH dedup is deferred — rewriting PATH
// assignments across shell config is too easy to get wrong and arguably
// outside the v1 charter.
const buildAutoFixes = async (recs: Recommendation[]): Promise<AutoFix[]> => {
  const fixes: AutoFix[] = [];

  if (recs.some((r) => r.rule === 'multiple-compinit')) {
    const zshenv = join(homedir(), '.zshenv');
    let before = '';
    if (await pathExists(zshenv)) {
      try {
        before = await readFile(zshenv, 'utf-8');
      } catch {
        // Can't read — surface as a skipped fix so the user sees why.
        return fixes;
      }
    }
    const alreadyPresent = /^\s*skip_global_compinit\s*=\s*1\s*(?:#.*)?$/m.test(before);
    if (!alreadyPresent) {
      const sep = before.length === 0 || before.endsWith('\n') ? '' : '\n';
      const after = before + sep + 'skip_global_compinit=1\n';
      fixes.push({
        rule: 'multiple-compinit',
        targetPath: zshenv,
        before,
        after,
        summary: `append \`skip_global_compinit=1\` to ${zshenv}`,
      });
    }
  }

  return fixes;
};

const renderAutoFixPreview = (fix: AutoFix): string => {
  const beforeLines = fix.before.split('\n');
  const afterLines = fix.after.split('\n');
  const out: string[] = [];
  out.push(c.bold(`--- a/${fix.targetPath}`));
  out.push(c.bold(`+++ b/${fix.targetPath}`));

  // Minimal diff — append-only, so show last few unchanged lines as context
  // followed by the added tail.
  const context = beforeLines.slice(Math.max(0, beforeLines.length - 3));
  for (const line of context) out.push(c.dim(`  ${line}`));
  for (let i = beforeLines.length; i < afterLines.length; i++) {
    out.push(c.green(`+ ${afterLines[i]}`));
  }
  return out.join('\n');
};

const runAutoFixes = async (fixes: AutoFix[], options: OptimizeOptions): Promise<void> => {
  if (fixes.length === 0) {
    logger.info('No auto-applicable fixes available for the detected issues.');
    return;
  }

  console.log();
  logger.info(
    `Proposed auto-fixes (${fixes.length}):`,
  );
  console.log();
  for (const fix of fixes) {
    console.log(c.bold(fix.targetPath) + ' ' + c.dim(`(${fix.summary})`));
    console.log(renderAutoFixPreview(fix));
    console.log();
  }

  let confirmed: boolean;
  if (options.yes) {
    confirmed = true;
  } else if (!isInteractive()) {
    logger.error(
      'Cannot confirm fixes in non-interactive mode. Re-run with --yes after reviewing the preview above.',
    );
    confirmed = false;
  } else {
    confirmed = await prompts.confirm(
      `Apply ${fixes.length} auto-fix${fixes.length === 1 ? '' : 'es'}?`,
      false,
    );
  }

  if (!confirmed) {
    logger.info('No changes written.');
    return;
  }

  // Snapshot BEFORE writing. Files that don't exist get recorded as
  // `existed: false` in the snapshot metadata — `tuck undo` will delete
  // rather than restore if we created a brand-new file here.
  const snapshot = await createSnapshot(
    fixes.map((f) => f.targetPath),
    `Pre-optimize --auto backup (${fixes.length} file${fixes.length === 1 ? '' : 's'})`,
    { kind: 'optimize-auto' },
  );
  logger.info(`Snapshot created: ${c.dim(snapshot.id)}`);

  for (const fix of fixes) {
    await writeFile(fix.targetPath, fix.after, 'utf-8');
  }
  logger.success(
    `Applied ${fixes.length} fix${fixes.length === 1 ? '' : 'es'}. Use 'tuck undo ${snapshot.id}' to revert.`,
  );
};

export const runOptimize = async (options: OptimizeOptions): Promise<void> => {
  const shell = resolveProfileShell(options.shell, process.env.SHELL);
  const run = await runShellProfile(shell);
  if (!run.available) {
    logger.error(`${shell} is not installed. \`tuck optimize\` requires ${shell} for profiling.`);
    process.exitCode = 1;
    return;
  }
  if (run.exitCode !== 0) {
    logger.warning(
      `${shell} exited with code ${run.exitCode}. Profile may be incomplete.`,
    );
  }

  const report = parseXtrace(run.stderr);
  const sources = await readShellSources(shell);
  const recs = options.profile ? [] : applyRules(report, sources);

  if (options.format === 'json') {
    console.log(
      JSON.stringify(
        {
          shell,
          totalMs: report.totalMs,
          eventCount: report.events.length,
          perFile: report.perFile.slice(0, 10),
          recommendations: recs,
        },
        null,
        2,
      ),
    );
    return;
  }

  prompts.intro(`tuck optimize (${shell})`);
  console.log();
  printProfileReport(report);
  if (!options.profile) {
    printRecommendations(recs);
  }

  if (options.auto && !options.profile) {
    const fixes = await buildAutoFixes(recs);
    await runAutoFixes(fixes, options);
  }

  prompts.outro(
    recs.length > 0
      ? `${recs.length} recommendation${recs.length === 1 ? '' : 's'} — review above`
      : 'Profile complete',
  );
};

export const optimizeCommand = new Command('optimize')
  .description('Profile shell startup + surface rule-based recommendations')
  .option('--profile', 'Profile only — skip the recommendation engine')
  .option('--auto', 'Preview + apply the safe subset of auto-fixes (with confirmation)')
  .option('-y, --yes', 'Skip the confirmation prompt (still previews, still snapshots)')
  .option('--format <type>', 'Output format: text | json', 'text')
  .option('--shell <name>', 'Shell to profile: zsh | bash (default: detect from $SHELL)')
  .action(async (options: OptimizeOptions) => {
    await runOptimize(options);
  });
