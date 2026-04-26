import { spawn } from 'child_process';
import type { ValidationIssue } from './index.js';

// Dispatch by filename: zsh files need zsh -n (bash -n mis-parses some zsh
// syntax like `=(...)` process substitution and `(( ))` math expansions).
// Everything else goes through bash -n, which covers .sh / .bash / POSIX
// shell fragments without false-positives.
const isZshFile = (path: string): boolean => {
  const basename = path.toLowerCase().split('/').pop() || '';
  return (
    /\.zsh$/.test(basename) ||
    /^\.?(zshrc|zshenv|zprofile|zlogin|zlogout)$/.test(basename)
  );
};

const SYNTAX_ERROR_RE = /(?::|line )\s*(\d+)[:\s]+(.+)$/;

const runInterpreter = async (
  interpreter: string,
  path: string,
): Promise<{ stderr: string; exitCode: number; available: boolean }> => {
  return await new Promise((resolve) => {
    const child = spawn(interpreter, ['-n', path], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      // ENOENT — interpreter not installed; skip, don't fail.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ stderr: '', exitCode: 0, available: false });
        return;
      }
      resolve({ stderr: err.message, exitCode: 1, available: true });
    });
    child.on('close', (code) => {
      resolve({ stderr, exitCode: code ?? 0, available: true });
    });
  });
};

const parseShellErrors = (stderr: string, path: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const raw of stderr.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Normalize: strip leading `<path>:` if present so the offsets are clean.
    const withoutPath = line.startsWith(path) ? line.slice(path.length) : line;
    const match = SYNTAX_ERROR_RE.exec(withoutPath);
    if (match) {
      issues.push({
        severity: 'error',
        line: parseInt(match[1], 10),
        message: match[2].trim(),
      });
    } else {
      issues.push({ severity: 'error', message: line });
    }
  }
  return issues;
};

// shellcheck output (--format=gcc) is `<path>:<line>:<col>: <severity>: <msg>
// [SC####]`. We promote `error`-level findings and demote `warning`/`note` to
// our `warning` severity. shellcheck doesn't understand zsh, so we only run
// it for non-zsh files — feeding it `.zshrc` is noisy false-positives.
const SHELLCHECK_LINE_RE = /^[^:]+:(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/;

// Exported for unit tests — kept as a pure transformation so tests don't
// need shellcheck on the path.
export const parseShellcheckOutput = (stdout: string): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  for (const raw of stdout.split('\n')) {
    const match = SHELLCHECK_LINE_RE.exec(raw.trim());
    if (!match) continue;
    const sev: ValidationIssue['severity'] = match[3] === 'error' ? 'error' : 'warning';
    issues.push({
      severity: sev,
      line: parseInt(match[1], 10),
      column: parseInt(match[2], 10),
      message: match[4],
    });
  }
  return issues;
};

const runShellcheck = async (
  path: string,
): Promise<{ issues: ValidationIssue[]; available: boolean }> => {
  return await new Promise((resolve) => {
    // stderr discarded: shellcheck reserves it for tool-itself failures
    // (broken install, parse crash). We don't surface those — findings
    // live on stdout in `--format=gcc`.
    const child = spawn('shellcheck', ['--format=gcc', path], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ issues: [], available: false });
        return;
      }
      // Spawned but failed before producing parseable output — surface the
      // stderr as a single warning so the user knows something went sideways
      // without conflating it with an actual lint finding.
      resolve({
        issues: [{ severity: 'warning', message: `shellcheck: ${err.message}` }],
        available: true,
      });
    });
    child.on('close', () => {
      resolve({ issues: parseShellcheckOutput(stdout), available: true });
    });
  });
};

export const validateShell = async (
  absolutePath: string,
  _content: string,
): Promise<{ issues: ValidationIssue[]; skipped?: boolean; skipReason?: string }> => {
  const interpreter = isZshFile(absolutePath) ? 'zsh' : 'bash';
  const result = await runInterpreter(interpreter, absolutePath);

  if (!result.available) {
    return {
      issues: [],
      skipped: true,
      skipReason: `${interpreter} not installed — install ${interpreter} for syntax checking`,
    };
  }

  const issues = result.exitCode === 0 ? [] : parseShellErrors(result.stderr, absolutePath);

  // shellcheck only handles bash/POSIX — running it on zsh files yields
  // false positives on zsh-only constructs. Skip it for zsh files. Also
  // skip when the interpreter parse already failed: shellcheck on a file
  // with a syntax error tends to spew confused diagnostics that just
  // duplicate the real problem.
  if (interpreter === 'bash' && issues.length === 0) {
    const sc = await runShellcheck(absolutePath);
    if (sc.available) {
      issues.push(...sc.issues);
    }
  }

  return { issues };
};
