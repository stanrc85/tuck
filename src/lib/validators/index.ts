import { detectLanguage } from '../syntaxHighlight.js';
import { validateJson } from './json.js';
import { validateToml } from './toml.js';
import { validateShell } from './shell.js';
import { validateLua } from './lua.js';
import { validateYaml } from './yaml.js';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  line?: number;
  column?: number;
  message: string;
}

export interface ValidationResult {
  file: string;
  language: string | null;
  // `skipped` means we don't have a validator for this file type OR an
  // optional external validator (e.g. luac) is not installed. Callers
  // surface skipped reasons but don't count them as failures.
  skipped?: boolean;
  skipReason?: string;
  issues: ValidationIssue[];
}

export const hasErrors = (result: ValidationResult): boolean =>
  result.issues.some((i) => i.severity === 'error');

export const validateFile = async (
  absolutePath: string,
  displayPath: string,
  content: string,
): Promise<ValidationResult> => {
  const language = detectLanguage(displayPath);

  if (language === null) {
    return {
      file: displayPath,
      language: null,
      skipped: true,
      skipReason: 'Unknown file type',
      issues: [],
    };
  }

  switch (language) {
    case 'json':
      return { file: displayPath, language, issues: validateJson(content) };
    case 'toml':
      return { file: displayPath, language, issues: validateToml(content) };
    case 'shell':
      return {
        file: displayPath,
        language,
        ...(await validateShell(absolutePath, content)),
      };
    case 'lua':
      return {
        file: displayPath,
        language,
        ...(await validateLua(absolutePath)),
      };
    case 'yaml':
      return { file: displayPath, language, issues: validateYaml(content) };
    default:
      return {
        file: displayPath,
        language,
        skipped: true,
        skipReason: `No validator for ${language}`,
        issues: [],
      };
  }
};

export { computeFixes, applyFixes, renderFixDiff } from './fixers.js';
export type { FixProposal } from './fixers.js';
