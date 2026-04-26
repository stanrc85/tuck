import { parse, YAMLError } from 'yaml';
import type { ValidationIssue } from './index.js';

// `yaml` (eemeli/yaml) collects every parse error into a single thrown
// YAMLParseError or aggregates them depending on options. We use the parser's
// non-throwing `prettyErrors` machinery via `parse(content, { strict: false })`
// + manual error collection on the document so we can surface line:col.
export const validateYaml = (content: string): ValidationIssue[] => {
  try {
    // The cheap path: throws on the first hard error. For strict files this
    // is enough — most users want "does this load cleanly?" feedback.
    parse(content);
    return [];
  } catch (err) {
    if (err instanceof YAMLError) {
      const issue: ValidationIssue = {
        severity: 'error',
        message: err.message.split('\n')[0],
      };
      // YAMLError.linePos is `[{ line, col }, { line, col }]?` when the
      // source map could be resolved. Older error variants only carry a
      // numeric `pos` offset — we leave line:col undefined in that case
      // rather than recompute.
      const start = err.linePos?.[0];
      if (start) {
        issue.line = start.line;
        issue.column = start.col;
      }
      return [issue];
    }
    return [
      {
        severity: 'error',
        message: err instanceof Error ? err.message : 'YAML parse error',
      },
    ];
  }
};
