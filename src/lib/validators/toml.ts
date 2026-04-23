import { parse } from 'smol-toml';
import type { ValidationIssue } from './index.js';

// smol-toml throws TomlError with `.line` and `.column` props (1-indexed).
// Fall back gracefully if the thrown error shape changes across versions.
interface TomlErrorShape {
  message: string;
  line?: number;
  column?: number;
}

const isTomlErrorShape = (e: unknown): e is TomlErrorShape =>
  typeof e === 'object' && e !== null && 'message' in e;

export const validateToml = (content: string): ValidationIssue[] => {
  try {
    parse(content);
    return [];
  } catch (error) {
    if (isTomlErrorShape(error)) {
      return [
        {
          severity: 'error',
          line: typeof error.line === 'number' ? error.line : undefined,
          column: typeof error.column === 'number' ? error.column : undefined,
          message: error.message,
        },
      ];
    }
    return [{ severity: 'error', message: String(error) }];
  }
};
