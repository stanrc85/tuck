import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { prompts, colors as c, formatCount } from '../ui/index.js';
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

const formatIssueLines = (result: ValidationResult): string => {
  return result.issues
    .map((issue) => {
      const loc =
        issue.line !== undefined
          ? `${issue.line}${issue.column !== undefined ? `:${issue.column}` : ''}`
          : '—';
      const sev = issue.severity === 'error' ? c.red('error') : c.yellow('warn');
      return `    ${c.dim(loc.padEnd(6))} ${sev}  ${issue.message}`;
    })
    .join('\n');
};

const printTextResults = (results: ValidationResult[]): void => {
  for (const r of results) {
    if (r.skipped) {
      prompts.log.message(c.dim(`${r.file} (${r.skipReason})`));
    } else if (r.issues.length === 0) {
      prompts.log.success(r.file);
    } else if (hasErrors(r)) {
      prompts.log.error(`${r.file} ${c.dim(`(${r.language})`)}\n${formatIssueLines(r)}`);
    } else {
      prompts.log.warning(`${r.file} ${c.dim(`(${r.language})`)}\n${formatIssueLines(r)}`);
    }
  }
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
    prompts.log.success('No auto-fixable issues found.');
    return;
  }

  prompts.log.info(`Proposed fixes across ${formatCount(proposals.length, 'file')}:`);
  for (const p of proposals) {
    prompts.log.message(`${c.bold(p.file)} ${c.dim(`(${p.fixes.join(', ')})`)}`);
    prompts.log.message(renderFixDiff(p));
  }

  let confirmed: boolean;
  if (options.yes) {
    confirmed = true;
  } else if (!isInteractive()) {
    prompts.log.error(
      'Cannot confirm fix in non-interactive mode. Re-run with --yes after reviewing the preview above.',
    );
    confirmed = false;
  } else {
    confirmed = await prompts.confirm(
      `Apply fixes to ${formatCount(proposals.length, 'file')}?`,
      false,
    );
  }

  if (!confirmed) {
    prompts.log.message(c.dim('No changes written.'));
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
  prompts.log.message(c.dim(`Snapshot created: ${snapshot.id}`));

  await applyFixes(proposals);
  prompts.log.success(
    `Applied fixes to ${formatCount(proposals.length, 'file')}. Use \`tuck undo ${snapshot.id}\` to revert.`,
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
    if (results.some((r) => hasErrors(r))) {
      process.exitCode = 1;
    }
    return;
  }

  prompts.intro('tuck validate');

  printTextResults(results);

  const passCount = results.filter((r) => !r.skipped && r.issues.length === 0).length;
  const failCount = results.filter((r) => hasErrors(r)).length;
  const skipCount = results.filter((r) => r.skipped).length;

  prompts.log.message(
    `${c.green(`${passCount} passed`)}, ${c.red(`${failCount} failed`)}, ${c.dim(`${skipCount} skipped`)}`,
  );

  if (options.fix) {
    await runFixPass(targets, options);
  }

  prompts.outro(
    failCount > 0
      ? `${formatCount(failCount, 'file')} with errors`
      : `All ${formatCount(results.length, 'file')} valid`,
  );

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
