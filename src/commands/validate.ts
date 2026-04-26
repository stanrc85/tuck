import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { prompts, logger, colors as c } from '../ui/index.js';
import { getTuckDir } from '../lib/paths.js';
import { loadManifest, assertMigrated } from '../lib/manifest.js';
import { isBinaryExecutable } from '../lib/binary.js';
import {
  hasErrors,
  computeFixes,
  applyFixes,
  renderFixDiff,
  type ValidationResult,
  type FixProposal,
} from '../lib/validators/index.js';
import {
  collectValidationTargets,
  runValidationSweep,
  type ValidationTarget,
} from '../lib/validators/sweep.js';
import { createSnapshot } from '../lib/timemachine.js';
import { NotInitializedError } from '../errors.js';

interface ValidateOptions {
  format?: 'text' | 'json';
  fix?: boolean;
  yes?: boolean;
}

const isInteractive = (): boolean => Boolean(process.stdout.isTTY);

const formatResultText = (result: ValidationResult): string => {
  if (result.skipped) {
    return `${c.dim('skip')} ${result.file} ${c.dim(`(${result.skipReason})`)}`;
  }
  if (result.issues.length === 0) {
    return `${c.green('pass')} ${result.file}`;
  }
  const header = `${c.red('fail')} ${result.file} ${c.dim(`(${result.language})`)}`;
  const body = result.issues.map((issue) => {
    const loc =
      issue.line !== undefined
        ? `${issue.line}${issue.column !== undefined ? `:${issue.column}` : ''}`
        : '—';
    const sev = issue.severity === 'error' ? c.red('error') : c.yellow('warn');
    return `    ${c.dim(loc.padEnd(6))} ${sev}  ${issue.message}`;
  });
  return [header, ...body].join('\n');
};

const printTextReport = (results: ValidationResult[]): void => {
  for (const r of results) console.log(formatResultText(r));
  console.log();
  const pass = results.filter((r) => !r.skipped && r.issues.length === 0).length;
  const fail = results.filter((r) => hasErrors(r)).length;
  const skipped = results.filter((r) => r.skipped).length;
  logger.info(
    `${c.green(`${pass} passed`)}, ${c.red(`${fail} failed`)}, ${c.dim(`${skipped} skipped`)}`,
  );
};

const printJsonReport = (results: ValidationResult[]): void => {
  const summary = {
    total: results.length,
    passed: results.filter((r) => !r.skipped && r.issues.length === 0).length,
    failed: results.filter((r) => hasErrors(r)).length,
    skipped: results.filter((r) => r.skipped).length,
  };
  console.log(JSON.stringify({ summary, results }, null, 2));
};

// Build + preview + prompt + snapshot + write. Any step that writes user
// data is gated behind the confirm prompt; if the user says no, nothing
// touches disk. Non-TTY invocations without --yes refuse to write.
const runFixPass = async (
  targets: ValidationTarget[],
  options: ValidateOptions,
): Promise<void> => {
  const proposals: FixProposal[] = [];
  for (const t of targets) {
    if (await isBinaryExecutable(t.absolutePath)) continue;
    let content: string;
    try {
      content = await readFile(t.absolutePath, 'utf-8');
    } catch {
      continue;
    }
    const proposal = computeFixes(t.displayPath, t.absolutePath, content);
    if (proposal) proposals.push(proposal);
  }

  if (proposals.length === 0) {
    logger.success('No auto-fixable issues found.');
    return;
  }

  console.log();
  logger.info(
    `Proposed fixes across ${proposals.length} file${proposals.length === 1 ? '' : 's'}:`,
  );
  console.log();
  for (const p of proposals) {
    console.log(c.bold(p.file) + ' ' + c.dim(`(${p.fixes.join(', ')})`));
    console.log(renderFixDiff(p));
    console.log();
  }

  let confirmed: boolean;
  if (options.yes) {
    confirmed = true;
  } else if (!isInteractive()) {
    logger.error(
      'Cannot confirm fix in non-interactive mode. Re-run with --yes after reviewing the preview above.',
    );
    confirmed = false;
  } else {
    confirmed = await prompts.confirm(
      `Apply fixes to ${proposals.length} file${proposals.length === 1 ? '' : 's'}?`,
      false,
    );
  }

  if (!confirmed) {
    logger.info('No changes written.');
    return;
  }

  // Snapshot BEFORE touching disk. `tuck undo` restores from the snapshot if
  // the fix turns out to be wrong — the user's original content is preserved
  // even across multiple edits in this batch.
  const snapshot = await createSnapshot(
    proposals.map((p) => p.absolutePath),
    `Pre-validate --fix backup (${proposals.length} file${proposals.length === 1 ? '' : 's'})`,
    { kind: 'validate-fix' },
  );
  logger.info(`Snapshot created: ${c.dim(snapshot.id)}`);

  await applyFixes(proposals);
  logger.success(
    `Applied fixes to ${proposals.length} file${proposals.length === 1 ? '' : 's'}. Use 'tuck undo ${snapshot.id}' to revert.`,
  );
};

export const runValidate = async (
  paths: string[],
  options: ValidateOptions,
): Promise<void> => {
  const tuckDir = getTuckDir();

  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);

  const targets = await collectValidationTargets(tuckDir, paths);
  const results: ValidationResult[] = await runValidationSweep(targets);

  if (options.format === 'json') {
    printJsonReport(results);
  } else {
    if (paths.length === 0) prompts.intro('tuck validate');
    printTextReport(results);
  }

  if (options.fix) {
    await runFixPass(targets, options);
  }

  if (paths.length === 0 && options.format !== 'json') {
    const failCount = results.filter((r) => hasErrors(r)).length;
    prompts.outro(
      failCount > 0
        ? `Found ${failCount} file${failCount === 1 ? '' : 's'} with errors`
        : 'All files valid',
    );
  }

  if (results.some((r) => hasErrors(r))) {
    process.exitCode = 1;
  }
};

export const validateCommand = new Command('validate')
  .description('Validate syntax of tracked files (JSON, TOML, YAML, shell, Lua)')
  .argument('[paths...]', 'Specific files to validate')
  .option('--format <type>', 'Output format: text | json', 'text')
  .option('--fix', 'Preview + apply fixes (trailing whitespace, EOF newline, JSON pretty-print)')
  .option('-y, --yes', 'Skip the confirmation prompt (still previews, still snapshots)')
  .action(async (paths: string[], options: ValidateOptions) => {
    await runValidate(paths, options);
  });
