import { colors as c } from '../../ui/theme.js';
import { detectLanguage } from '../syntaxHighlight.js';

export interface FixProposal {
  file: string;              // display path (e.g. ~/.zshrc)
  absolutePath: string;      // resolved path for writing
  before: string;
  after: string;
  fixes: string[];           // human-readable list of what changed
}

const TRAILING_WS_RE = /[ \t]+$/;

// Re-emit JSON as canonical 2-space-indented form. Returns the new text and
// whether anything changed. Skips silently when the input doesn't parse so
// validate's --fix doesn't try to "fix" something with a real syntax error
// that the user needs to see first via the regular validate output.
const tryPrettyPrintJson = (
  content: string,
): { after: string; changed: boolean } => {
  try {
    const parsed = JSON.parse(content);
    // 2-space indent matches the project conventions for tracked configs
    // (eslint, prettier, vscode all default here). JSON.stringify omits the
    // trailing newline; we add one for POSIX compliance.
    const reformatted = JSON.stringify(parsed, null, 2) + '\n';
    return { after: reformatted, changed: reformatted !== content };
  } catch {
    return { after: content, changed: false };
  }
};

// Build a proposal if any fixable pattern matches. Returns null when the
// content is already clean so the caller can filter before prompting — no
// point asking the user to confirm a no-op.
export const computeFixes = (
  file: string,
  absolutePath: string,
  content: string,
): FixProposal | null => {
  const language = detectLanguage(file);

  // JSON pretty-print supersedes line-level whitespace fixes: the round-trip
  // through JSON.stringify normalises whitespace, indentation, and EOF
  // newline in one shot. If the file isn't valid JSON, fall through to the
  // generic line-level fixer below — leave the parse error for `validate`
  // proper to surface.
  if (language === 'json') {
    const { after, changed } = tryPrettyPrintJson(content);
    if (changed) {
      return {
        file,
        absolutePath,
        before: content,
        after,
        fixes: ['pretty-print JSON (2-space indent)'],
      };
    }
    // Already pretty OR doesn't parse. In either case, let the line-level
    // fixer run — already-pretty content will produce null, broken-JSON
    // content can still benefit from trailing-whitespace cleanup.
  }

  const fixes: string[] = [];
  const lines = content.split('\n');
  let changedLines = 0;
  const cleaned = lines.map((line) => {
    if (TRAILING_WS_RE.test(line)) {
      changedLines++;
      return line.replace(TRAILING_WS_RE, '');
    }
    return line;
  });
  if (changedLines > 0) {
    fixes.push(
      `strip trailing whitespace (${changedLines} line${changedLines === 1 ? '' : 's'})`,
    );
  }

  let after = cleaned.join('\n');

  // Guarantee a single trailing newline if the original had content. Empty
  // files stay empty; don't inject a newline into a zero-byte file.
  if (after.length > 0 && !after.endsWith('\n')) {
    after += '\n';
    fixes.push('add missing EOF newline');
  }

  if (after === content) return null;

  return { file, absolutePath, before: content, after, fixes };
};

// Small, self-contained diff preview so the validate command can render edits
// without pulling in the full tuck-diff renderer (which expects a FileDiff
// built against manifest-tracked content). Unified format, context-collapsed
// similarly to tuck diff but simpler: we just show changed lines + 1 line of
// context on each side, inline.
const CONTEXT = 1;

export const renderFixDiff = (proposal: FixProposal): string => {
  const before = proposal.before.split('\n');
  const after = proposal.after.split('\n');
  const max = Math.max(before.length, after.length);

  const lines: string[] = [];
  lines.push(c.bold(`--- a/${proposal.file}`));
  lines.push(c.bold(`+++ b/${proposal.file}`));

  const rows: Array<{ kind: 'same' | 'del' | 'add'; text: string; idx: number }> = [];
  for (let i = 0; i < max; i++) {
    const b = before[i];
    const a = after[i];
    if (b === a) {
      rows.push({ kind: 'same', text: b ?? '', idx: i });
    } else {
      if (b !== undefined) rows.push({ kind: 'del', text: b, idx: i });
      if (a !== undefined) rows.push({ kind: 'add', text: a, idx: i });
    }
  }

  // Collapse runs of same-lines longer than 2*CONTEXT, keeping CONTEXT rows
  // on each edge so users can see where the edit sits.
  const out: string[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== 'same') {
      out.push(rows[i].kind === 'del' ? c.red(`- ${rows[i].text}`) : c.green(`+ ${rows[i].text}`));
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].kind === 'same') j++;
    const runLen = j - i;
    const lead = i === 0 ? 0 : CONTEXT;
    const trail = j === rows.length ? 0 : CONTEXT;
    if (runLen <= lead + trail) {
      for (let k = i; k < j; k++) out.push(c.dim(`  ${rows[k].text}`));
    } else {
      for (let k = i; k < i + lead; k++) out.push(c.dim(`  ${rows[k].text}`));
      const skipped = runLen - lead - trail;
      out.push(c.dim(`  ┄ ${skipped} unchanged line${skipped === 1 ? '' : 's'} ┄`));
      for (let k = j - trail; k < j; k++) out.push(c.dim(`  ${rows[k].text}`));
    }
    i = j;
  }

  return [...lines, ...out].join('\n');
};

export const applyFixes = async (proposals: FixProposal[]): Promise<void> => {
  const { writeFile } = await import('fs/promises');
  for (const p of proposals) {
    await writeFile(p.absolutePath, p.after, 'utf-8');
  }
};
