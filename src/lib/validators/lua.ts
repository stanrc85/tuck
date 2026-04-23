import { spawn } from 'child_process';
import type { ValidationIssue } from './index.js';

// `luac -p` is the compile-check-only mode of the Lua compiler. Lua is a
// tuck-friendly file type (nvim configs dominate) but `luac` isn't always
// installed — warn-skip when missing rather than fail the whole run.
const LUAC_ERROR_RE = /^luac:\s*(.+?):(\d+):\s*(.+)$/;

export const validateLua = async (
  absolutePath: string,
): Promise<{ issues: ValidationIssue[]; skipped?: boolean; skipReason?: string }> => {
  return await new Promise((resolve) => {
    const child = spawn('luac', ['-p', absolutePath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({
          issues: [],
          skipped: true,
          skipReason: 'luac not installed — install lua for syntax checking',
        });
        return;
      }
      resolve({ issues: [{ severity: 'error', message: err.message }] });
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ issues: [] });
        return;
      }
      const issues: ValidationIssue[] = [];
      for (const raw of stderr.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const match = LUAC_ERROR_RE.exec(line);
        if (match) {
          issues.push({
            severity: 'error',
            line: parseInt(match[2], 10),
            message: match[3].trim(),
          });
        } else {
          issues.push({ severity: 'error', message: line });
        }
      }
      resolve({ issues });
    });
  });
};
