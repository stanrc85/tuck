import { Command } from 'commander';
import { prompts, colors as c } from '../ui/index.js';
import {
  DOCTOR_CATEGORIES,
  getDoctorExitCode,
  runDoctorChecks,
  type DoctorCategory,
  type DoctorReport,
} from '../lib/doctor.js';
import type { DoctorOptions } from '../types.js';

const isDoctorCategory = (value: string): value is DoctorCategory => {
  return (DOCTOR_CATEGORIES as readonly string[]).includes(value);
};

const formatCheckId = (id: string): string => {
  return id.replace('.', ': ');
};

const formatCheckLabel = (category: string, id: string, message: string): string => {
  return `${c.dim(`[${category}]`)} ${formatCheckId(id)} — ${message}`;
};

const formatSubBlock = (details?: string, fix?: string): string | null => {
  const lines: string[] = [];
  if (details) lines.push(`Details: ${details}`);
  if (fix) lines.push(`Fix: ${fix}`);
  return lines.length === 0 ? null : c.dim(lines.join('\n'));
};

const num = (n: number): string => c.bold(n.toString());
const plural = (n: number, word: string): string => (n === 1 ? word : `${word}s`);

const formatSummary = (summary: DoctorReport['summary'], exitCode: number): string => {
  const { passed, warnings, failed } = summary;
  if (exitCode === 0) {
    return `${num(passed)} ${plural(passed, 'check')} passed`;
  }
  if (exitCode === 2) {
    return `${num(passed)} passed, ${num(warnings)} ${plural(warnings, 'warning')} (strict)`;
  }
  return `${num(passed)} passed, ${num(warnings)} ${plural(warnings, 'warning')}, ${num(failed)} failed`;
};

const printHumanReport = (report: DoctorReport, exitCode: number): void => {
  prompts.intro('tuck doctor');

  for (const check of report.checks) {
    const label = formatCheckLabel(check.category, check.id, check.message);

    if (check.status === 'pass') {
      prompts.log.success(label);
    } else if (check.status === 'warn') {
      prompts.log.warning(label);
    } else {
      prompts.log.error(label);
    }

    const sub = formatSubBlock(check.details, check.fix);
    if (sub) {
      prompts.log.message(sub);
    }
  }

  const summary = formatSummary(report.summary, exitCode);
  if (exitCode === 0) {
    prompts.outro(summary);
  } else if (exitCode === 2) {
    prompts.outro.warning(summary);
  } else {
    prompts.outro.error(summary);
  }
};

export const runDoctor = async (options: DoctorOptions = {}): Promise<DoctorReport> => {
  const report = await runDoctorChecks({
    category: options.category,
  });

  const exitCode = getDoctorExitCode(report, options.strict);
  process.exitCode = exitCode;

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report, exitCode);
  }

  return report;
};

export const doctorCommand = new Command('doctor')
  .description('Run repository health and safety diagnostics')
  .option('--json', 'Output as JSON')
  .option('--strict', 'Exit non-zero on warnings')
  .option(
    '-c, --category <category>',
    `Run only one category (${DOCTOR_CATEGORIES.join('|')})`,
    (value: string): DoctorCategory => {
      if (!isDoctorCategory(value)) {
        throw new Error(
          `Invalid category "${value}". Expected one of: ${DOCTOR_CATEGORIES.join(', ')}`
        );
      }
      return value;
    }
  )
  .action(async (options: DoctorOptions) => {
    await runDoctor(options);
  });
