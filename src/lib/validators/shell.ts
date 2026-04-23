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

  if (result.exitCode === 0) {
    return { issues: [] };
  }

  return { issues: parseShellErrors(result.stderr, absolutePath) };
};
