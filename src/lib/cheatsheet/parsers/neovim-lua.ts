import type { Entry, Parser, ParserContext } from '../types.js';

/**
 * Parse neovim keymaps from lua files. Three binding styles are
 * recognized — the three common ways modern configs declare a keymap:
 *
 *   1. vim.keymap.set(mode, lhs, rhs, opts?)
 *   2. vim.api.nvim_set_keymap(mode, lhs, rhs, opts?) (legacy API)
 *   3. lazy.nvim plugin-spec `keys = { { lhs, rhs?, desc = ..., mode = ... }, ... }`
 *
 * (3) is the big one — plugin-owned keybinds live here in the lazy.nvim
 * ecosystem (telescope, neo-tree, which-key, etc.) and would otherwise
 * be invisible to the cheatsheet.
 *
 * Approach (not a full lua parser — a targeted best-effort scanner):
 *
 *   1. Line-by-line, strip trailing `-- comment` text that isn't inside
 *      a string literal.
 *   2. For each keyword (`vim.keymap.set(`, `vim.api.nvim_set_keymap(`,
 *      or `keys = {`), scan forward with a string+depth-aware walk to
 *      find the matching closer.
 *   3. Split the inner slice on top-level commas and parse individual
 *      args or table rows per keyword semantics.
 *
 * Mode prefix in the rendered keybind: we omit it entirely when the
 * entry is single-mode `n` (normal mode — the overwhelming default)
 * and show `[n,v]` / `[v]` / `[i]` only for non-default cases. Keeps
 * the table visually clean without hiding mode info for the cases
 * where it matters.
 *
 * Long strings (`[[...]]`), `--[[ ... ]]` block comments, and dynamic
 * (non-literal) mode/lhs values aren't handled — they're rare in the
 * target files and degrade gracefully to no-entry rather than crash.
 */

const KEYMAP_KEYWORDS = ['vim.keymap.set(', 'vim.api.nvim_set_keymap('] as const;
const LAZY_KEYS_RE = /\bkeys\s*=\s*\{/g;

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
 * From an index `startAfter` pointing JUST after the opening bracket,
 * walk forward to the matching closer (paren / brace / square),
 * respecting strings, tables, and nested brackets. Returns the end
 * index (exclusive) of the args slice, or -1 on malformed input.
 */
const findClose = (
  src: string,
  startAfter: number,
  closer: ')' | '}' | ']'
): number => {
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
      if (depth === 0 && ch === closer) return i;
    }
  }
  return -1;
};

/** Legacy name kept for narrow call-sites that want only paren matching. */
const findCloseParen = (src: string, startAfter: number): number =>
  findClose(src, startAfter, ')');

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

/**
 * Format the mode prefix for the Entry.keybind. Single-mode `n`
 * renders as just the lhs (normal mode is the implicit default);
 * everything else gets a bracketed prefix so non-default modes stay
 * visible without cluttering the common case.
 */
const formatKeybind = (modes: readonly string[], lhs: string): string => {
  if (modes.length === 1 && modes[0] === 'n') return lhs;
  const label = modes.length === 1 ? modes[0] : modes.join(',');
  return `[${label}] ${lhs}`;
};

/**
 * Parse a single lazy.nvim `keys = { ... }` row (the inner `{ ... }`
 * block). Rows look like:
 *   { "<leader>ff", "<cmd>Telescope find_files<cr>", desc = "Find files" }
 *   { "<leader>y",  function() ... end, mode = {"n","v"}, desc = "Yank" }
 *
 * Positional arg 1 = lhs (string). Positional arg 2 (if present, and
 * not a named field) = rhs. Named `desc` / `mode` extracted via regex.
 */
const parseLazyKeyRow = (
  rowSrc: string,
  ctx: ParserContext,
  lineOffset: number,
  cleaned: string,
  rowStartOffset: number
): Entry | null => {
  const parts = splitTopLevelCommas(rowSrc);
  if (parts.length === 0) return null;

  const lhs = parseStringLiteral(parts[0]);
  if (lhs === null) return null;

  // Discover named fields anywhere in the row.
  const descMatch = rowSrc.match(/\bdesc\s*=\s*(['"])((?:\\.|[^\\])*?)\1/);
  const desc = descMatch ? descMatch[2] : null;

  // `mode = "v"` OR `mode = { "n", "v" }` OR omitted (defaults to "n").
  let modes: string[] = ['n'];
  const modeStrMatch = rowSrc.match(/\bmode\s*=\s*(['"])((?:\\.|[^\\])*?)\1/);
  const modeArrMatch = rowSrc.match(/\bmode\s*=\s*\{([^}]*)\}/);
  if (modeStrMatch) {
    modes = [modeStrMatch[2]];
  } else if (modeArrMatch) {
    const parsedArr = parseStringArray(`{${modeArrMatch[1]}}`);
    if (parsedArr && parsedArr.length > 0) modes = parsedArr;
  }

  // Positional arg 2 (if present and not a `name = value` pair) is rhs.
  let rhsExpr = '';
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(part)) break; // hit a named field
    rhsExpr = part;
    break;
  }

  const action =
    desc ?? parseStringLiteral(rhsExpr) ?? (rhsExpr.length > 0 ? summarizeRhs(rhsExpr) : '(no action)');

  return {
    keybind: formatKeybind(modes, lhs),
    action,
    sourceFile: ctx.sourceFile,
    sourceLine: offsetToLine(cleaned, rowStartOffset) + lineOffset,
  };
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

        entries.push({
          keybind: formatKeybind(modes, lhs),
          action: action.length > 0 ? action : '(no action)',
          sourceFile: ctx.sourceFile,
          sourceLine: line,
        });
      }
    }

    // Pass 2: scan for lazy.nvim `keys = { ... }` blocks and parse each
    // inner `{ ... }` row. Plugin-spec keybinds live here in modern
    // configs (telescope, neo-tree, which-key, gitsigns, etc.).
    LAZY_KEYS_RE.lastIndex = 0;
    let lazyMatch: RegExpExecArray | null;
    while ((lazyMatch = LAZY_KEYS_RE.exec(cleaned)) !== null) {
      const openBrace = lazyMatch.index + lazyMatch[0].length - 1;
      const close = findClose(cleaned, openBrace + 1, '}');
      if (close < 0) continue;
      const innerSrc = cleaned.slice(openBrace + 1, close);
      const baseLine = offsetToLine(cleaned, lazyMatch.index) - 1;

      // Split into top-level rows (each a `{ ... }` or `"string"` entry).
      const rows = splitTopLevelCommas(innerSrc);
      let cursorOffset = openBrace + 1;
      for (const rowRaw of rows) {
        const row = rowRaw.trim();
        if (!row.startsWith('{')) {
          cursorOffset += rowRaw.length + 1;
          continue;
        }
        // Peel the outer braces off the row to get its internals.
        const rowInner = row.slice(1, row.endsWith('}') ? -1 : undefined);
        const rowStart = cleaned.indexOf(row, cursorOffset);
        const entry = parseLazyKeyRow(rowInner, ctx, baseLine, cleaned, rowStart >= 0 ? rowStart : openBrace);
        if (entry) entries.push(entry);
        cursorOffset += rowRaw.length + 1;
      }
    }

    return entries;
  },
};
