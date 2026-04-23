import type { ValidationIssue } from './index.js';

// V8 SyntaxError messages include a byte position we can turn into line:col
// by walking the source. Newer Node versions use
// `Unexpected token ... at position N` or `... in JSON at position N (line L column C)`.
const POSITION_RE = /at position (\d+)/;
const LINE_COL_RE = /line (\d+) column (\d+)/;

const positionToLineCol = (
  source: string,
  pos: number,
): { line: number; column: number } => {
  let line = 1;
  let column = 1;
  const stop = Math.min(pos, source.length);
  for (let i = 0; i < stop; i++) {
    if (source[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
};

export const validateJson = (content: string): ValidationIssue[] => {
  try {
    JSON.parse(content);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    const lineCol = LINE_COL_RE.exec(message);
    if (lineCol) {
      return [
        {
          severity: 'error',
          line: parseInt(lineCol[1], 10),
          column: parseInt(lineCol[2], 10),
          message,
        },
      ];
    }

    const posMatch = POSITION_RE.exec(message);
    if (posMatch) {
      const { line, column } = positionToLineCol(content, parseInt(posMatch[1], 10));
      return [{ severity: 'error', line, column, message }];
    }

    return [{ severity: 'error', message }];
  }
};
