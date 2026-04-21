import type { Entry, Parser, ParserContext } from '../types.js';

/**
 * Parse `vim.keymap.set(...)` and `vim.api.nvim_set_keymap(...)` calls
 * from lua files under `~/.config/nvim/`. We match the two canonical
 * APIs explicitly rather than any 3+-arg function call that looks like
 * a keymap — the false-positive rate would be too high otherwise. Users
 * with custom `map` helpers can file a follow-up.
 *
 * Approach (not a full lua parser — a targeted best-effort scanner):
 *
 *   1. Line-by-line, strip trailing `-- comment` text that isn't inside
 *      a string literal. This handles the common `-- commented-out
 *      vim.keymap.set(...)` pattern without a real lexer.
 *   2. Find each occurrence of `vim.keymap.set(` or
 *      `vim.api.nvim_set_keymap(` in the cleaned content.
 *   3. Walk forward from the `(` maintaining paren depth + string state;
 *      when depth returns to zero we have the closing `)` and the
 *      argument slice.
 *   4. Split the arg slice on top-level commas (commas NOT inside
 *      strings / tables / parens) into up-to-four arguments.
 *   5. Arg 1 = mode (single quoted string OR table of quoted strings).
 *      Arg 2 = lhs (single quoted string).
 *      Arg 3 = rhs (any expression — used as fallback action text).
 *      Arg 4 (optional) = opts table — we only extract a `desc = "..."`.
 *   6. If mode or lhs aren't string-literal-parseable, the keymap is
 *      treated as dynamic (loop / variable-driven) and skipped silently.
 *
 * Long strings (`[[...]]`), multi-line strings, and `--[[ ... ]]` block
 * comments aren't handled in v1 — they're rare in keymap files. The
 * scanner degrades gracefully: a mis-parsed slice produces no entry.
 */

const KEYMAP_KEYWORDS = ['vim.keymap.set(', 'vim.api.nvim_set_keymap('] as const;

/** Strip `-- ...` to end-of-line when the `--` isn't inside a string. */
const stripLineComment = (line: string): string => {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      i++;
      continue;
    }
    if (!inDouble && ch === "'") inSingle = !inSingle;
    else if (!inSingle && ch === '"') inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === '-' && line[i + 1] === '-') {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
};

/**
 * From an index `startAfter` pointing JUST after the opening `(`,
 * walk forward to the matching `)` respecting strings, tables, and
 * nested parens. Returns the end index (exclusive) of the args slice,
 * or -1 if the closing paren can't be found (malformed input).
 */
const findCloseParen = (src: string, startAfter: number): number => {
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  for (let i = startAfter; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      i++;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '(' || ch === '{' || ch === '[') { depth++; continue; }
    if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && ch === ')') return i;
    }
  }
  return -1;
};

/**
 * Top-level comma split: break `args` at commas that aren't inside a
 * string, table, or nested paren group.
 */
const splitTopLevelCommas = (args: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === '\\' && i + 1 < args.length) {
      i++;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '(' || ch === '{' || ch === '[') { depth++; continue; }
    if (ch === ')' || ch === '}' || ch === ']') { depth--; continue; }
    if (ch === ',' && depth === 0) {
      out.push(args.slice(start, i));
      start = i + 1;
    }
  }
  out.push(args.slice(start));
  return out.map((s) => s.trim());
};

/** Parse a lua string literal — returns the contents, or null if not a plain string. */
const parseStringLiteral = (expr: string): string | null => {
  const match = expr.match(/^(['"])((?:\\.|[^\\])*?)\1$/);
  if (!match) return null;
  return match[2];
};

/** Parse a lua table of string literals — `{'n', 'v'}` — returns array or null. */
const parseStringArray = (expr: string): string[] | null => {
  const match = expr.match(/^\{\s*(.+?)\s*\}$/s);
  if (!match) return null;
  const parts = splitTopLevelCommas(match[1]);
  const out: string[] = [];
  for (const p of parts) {
    const s = parseStringLiteral(p);
    if (s === null) return null;
    out.push(s);
  }
  return out;
};

/** Extract `desc = '...'` / `desc = "..."` from an opts-table expression. */
const extractDesc = (optsExpr: string): string | null => {
  const match = optsExpr.match(/\bdesc\s*=\s*(['"])((?:\\.|[^\\])*?)\1/);
  if (!match) return null;
  return match[2];
};

/** Truncate an rhs expression for display (strip fn bodies, collapse whitespace). */
const summarizeRhs = (rhsExpr: string): string => {
  const collapsed = rhsExpr.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 80) return collapsed;
  return collapsed.slice(0, 77) + '…';
};

/** Byte offset → 1-indexed line number. Linear scan — fine at our scale. */
const offsetToLine = (src: string, offset: number): number => {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
};

export const neovimLuaParser: Parser = {
  id: 'neovim-lua',
  label: 'Neovim (lua)',
  match: (sourcePath: string) => {
    if (!sourcePath.endsWith('.lua')) return false;
    // Tolerate both separators so Windows sources still match.
    return /[/\\]nvim[/\\]/.test(sourcePath) || /[/\\]nvim$/.test(sourcePath);
  },
  parse: (content: string, ctx: ParserContext): Entry[] => {
    // Pass 1: strip line comments so a `-- vim.keymap.set(...)` line
    // doesn't trigger an entry. Newlines are preserved so our
    // offset-to-line computation on the cleaned buffer matches the
    // original file's line numbers.
    const cleaned = content
      .split('\n')
      .map((line) => stripLineComment(line))
      .join('\n');

    const entries: Entry[] = [];

    for (const keyword of KEYMAP_KEYWORDS) {
      let cursor = 0;
      while (cursor < cleaned.length) {
        const idx = cleaned.indexOf(keyword, cursor);
        if (idx < 0) break;
        const openParen = idx + keyword.length - 1; // points AT `(`
        const close = findCloseParen(cleaned, openParen + 1);
        if (close < 0) {
          // Malformed — advance past the open paren and continue.
          cursor = openParen + 1;
          continue;
        }
        const argsSlice = cleaned.slice(openParen + 1, close);
        cursor = close + 1;

        const args = splitTopLevelCommas(argsSlice);
        if (args.length < 2) continue;

        // Arg 1 — mode(s). Accept single string or array of strings.
        let modes: string[] | null = null;
        const modeStr = parseStringLiteral(args[0]);
        if (modeStr !== null) {
          modes = [modeStr];
        } else {
          modes = parseStringArray(args[0]);
        }
        if (modes === null) continue; // dynamic / non-literal — skip

        // Arg 2 — lhs.
        const lhs = parseStringLiteral(args[1]);
        if (lhs === null) continue;

        // Arg 3 — rhs (any expression).
        const rhsExpr = args[2] ?? '';

        // Arg 4 — opts (search for desc).
        const optsExpr = args[3] ?? '';
        const desc = extractDesc(optsExpr);

        const action =
          desc !== null
            ? desc
            : parseStringLiteral(rhsExpr) ?? summarizeRhs(rhsExpr);
        const line = offsetToLine(cleaned, idx);
        const modeLabel = modes.length === 1 ? modes[0] : `[${modes.join(',')}]`;

        entries.push({
          keybind: `${modeLabel} ${lhs}`,
          action: action.length > 0 ? action : '(no action)',
          sourceFile: ctx.sourceFile,
          sourceLine: line,
        });
      }
    }

    return entries;
  },
};
