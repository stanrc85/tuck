import type { Entry, Parser, ParserContext } from '../types.js';

/**
 * Parse `bindkey`, `alias`, and top-level function definitions from a
 * zsh config.
 *
 * Three sub-formats, handled in the same pass:
 *
 *   bindkey '^R' history-incremental-search-backward
 *   bindkey "^[[A" up-line-or-history
 *
 *   alias ll='ls -la'
 *   alias g=git
 *   alias -g ...G='| grep'   # global alias — captured, category=alias
 *
 *   function c(      ## Smart CD
 *   ) { ... }
 *   foo() {          ## bar
 *
 * A trailing `# comment` (or `## comment` — the double-hash convention
 * some users adopt to visually distinguish "doc" comments from "note"
 * comments) is promoted to the Entry action when present. Any run of
 * `#` chars at the split point is consumed. When no comment is present
 * bindkey/alias fall back to the widget / alias value as action; functions
 * without a docstring are skipped silently because the body is multi-line
 * and not summarisable — uncommented helpers are usually internal.
 *
 *   bindkey '^a' beginning-of-line      ## Move to start of line
 *       -> keybind '^a', action 'Move to start of line'
 *   alias ll='ls -la'  # long listing
 *       -> keybind 'll', action 'long listing'
 *   function c(  ## Smart CD
 *       -> keybind 'c', action 'Smart CD', category 'alias'
 *
 * Skipped:
 *   - comment-only lines and empty lines
 *   - mode-switch `bindkey -e` / `bindkey -v` (no binding, just options)
 *   - `unalias` (removes, not adds)
 *   - functions without a trailing doc-comment
 *
 * Entries from aliases AND functions both carry `category: 'alias'` —
 * functions are documented commands the user invokes by name, just like
 * aliases, and grouping them together (rather than in a separate
 * `function` bucket) matches how users mentally model their shortcuts.
 * Keybinds remain uncategorized. The v1 renderer ignores the category
 * and groups everything under the `zsh` section; a future
 * `--group-by category` flag will surface aliases+functions as one
 * group, keybinds as another.
 */

const LINE_COMMENT_RE = /^\s*#/;

const BINDKEY_RE = /^\s*bindkey\s+/;
const ALIAS_RE = /^\s*alias\s+/;

/**
 * Match a function definition prologue. Two accepted shapes:
 *   - zsh-style:   `function NAME` (parens / brace optional, may dangle
 *                   open-paren onto next line)
 *   - POSIX-style: `NAME ( )` (parens required together to disambiguate
 *                   from a bare identifier)
 *
 * After `splitCommentTrailing` removes any `## ...` tail, we only need
 * to recognize the leading prologue — the brace and body may be on this
 * line or on a following line, we don't care.
 */
const FUNCTION_KEYWORD_RE = /^\s*function\s+([A-Za-z_][A-Za-z0-9_:.+-]*)\b/;
const POSIX_FUNCTION_RE = /^\s*([A-Za-z_][A-Za-z0-9_:.+-]*)\s*\(\s*\)/;

/**
 * Match a section header comment like `# --- CURSOR MOVEMENT ---`,
 * `## === GIT ===`, or `# *** FZF ***`. Requires at least two
 * separator chars on each side to avoid capturing prose comments
 * like `# TODO: fix this`. Any run of leading `#` chars is accepted.
 * Captures the interior title (group 1) with surrounding whitespace
 * trimmed. The left and right separator runs don't have to match
 * type or length — `# --- GIT ===` is fine.
 */
const SECTION_HEADER_RE = /^\s*#+\s+[-=*_]{2,}\s+(.+?)\s+[-=*_]{2,}\s*$/;

/**
 * Split a line into `{code, comment}` on the first trailing `#`/`##`
 * that isn't inside quotes. Conservative — we only split when the
 * count of unescaped single+double quotes before the `#` is even
 * (i.e. not mid-string). Good enough for real-world zshrc lines,
 * which rarely embed `#` inside a quoted alias body.
 */
const splitCommentTrailing = (
  line: string
): { code: string; comment: string | null } => {
  const match = line.match(/^(.*?)\s+#+\s*(.*)$/);
  if (!match) return { code: line, comment: null };
  const code = match[1];
  const comment = match[2].trim();
  const quotes = (code.match(/(?<!\\)["']/g) ?? []).length;
  if (quotes % 2 !== 0) return { code: line, comment: null };
  return { code, comment: comment.length > 0 ? comment : null };
};

const parseBindkey = (
  line: string,
  index: number,
  ctx: ParserContext,
  comment: string | null,
  section: string | null
): Entry | null => {
  // Strip the `bindkey` keyword and any flags (-M <map>, -s, -e, -v, -a …).
  let rest = line.replace(BINDKEY_RE, '');

  // Drop flag clusters. We need to consume `-M <map>` as a pair but `-e`
  // and `-v` alone as bare flags, so loop until no more leading flags.
  while (rest.length > 0 && rest.startsWith('-')) {
    const flagMatch = rest.match(/^-[a-zA-Z]\S*/);
    if (!flagMatch) break;
    const flag = flagMatch[0];
    rest = rest.slice(flag.length).trimStart();
    // `-M`, `-A`, `-N` take an argument — consume the next token.
    if (/^-[MAN]/.test(flag) && !/^-[MAN]\S/.test(flag)) {
      const argMatch = rest.match(/^\S+/);
      if (argMatch) rest = rest.slice(argMatch[0].length).trimStart();
    }
  }

  // Mode-only `bindkey -e` / `bindkey -v` has nothing left — skip silently.
  if (rest.length === 0) return null;

  // First token = key sequence; may be quoted. Everything after is the widget name.
  const match = rest.match(/^(?:'([^']*)'|"([^"]*)"|(\S+))\s+(.+)$/);
  if (!match) return null;
  const key = match[1] ?? match[2] ?? match[3];
  const widget = match[4].trim();
  if (!key || !widget) return null;

  return {
    keybind: key,
    action: comment ?? widget,
    sourceFile: ctx.sourceFile,
    sourceLine: index + 1,
    ...(section ? { section } : {}),
  };
};

const parseAlias = (
  line: string,
  index: number,
  ctx: ParserContext,
  comment: string | null,
  section: string | null
): Entry | null => {
  let rest = line.replace(ALIAS_RE, '');

  // Drop alias flags (`-g`, `-s`, `-L`). One at a time, no arg-consuming flags.
  while (rest.length > 0 && rest.startsWith('-')) {
    const flagMatch = rest.match(/^-[a-zA-Z]/);
    if (!flagMatch) break;
    rest = rest.slice(flagMatch[0].length).trimStart();
  }

  // Shape: `name=value` or `name='value'` or `name="value"`.
  const match = rest.match(/^([A-Za-z_][A-Za-z0-9_.-]*|\.{3}[A-Za-z0-9_.-]+|\.{3}G)=(?:'([^']*)'|"([^"]*)"|(\S+))\s*$/);
  if (!match) return null;
  const name = match[1];
  const value = match[2] ?? match[3] ?? match[4] ?? '';

  return {
    keybind: name,
    action: comment ?? value,
    sourceFile: ctx.sourceFile,
    sourceLine: index + 1,
    category: 'alias',
    ...(section ? { section } : {}),
  };
};

const parseFunction = (
  code: string,
  index: number,
  ctx: ParserContext,
  comment: string | null,
  section: string | null
): Entry | null => {
  // Functions without a docstring are skipped — body is multi-line and
  // not summarisable, and uncommented functions are usually helpers the
  // user doesn't want surfaced in a cheatsheet.
  if (!comment) return null;

  const name =
    code.match(FUNCTION_KEYWORD_RE)?.[1] ?? code.match(POSIX_FUNCTION_RE)?.[1];
  if (!name) return null;

  return {
    keybind: name,
    action: comment,
    sourceFile: ctx.sourceFile,
    sourceLine: index + 1,
    category: 'alias',
    ...(section ? { section } : {}),
  };
};

export const zshParser: Parser = {
  id: 'zsh',
  label: 'zsh',
  match: (sourcePath: string) => {
    if (sourcePath.endsWith('.zshrc')) return true;
    if (sourcePath.endsWith('.zshenv')) return true;
    if (sourcePath.endsWith('.zprofile')) return true;
    if (sourcePath.endsWith('.zlogin')) return true;
    // ~/.config/zsh/ — user's zsh config dir per zdotdir convention.
    return /[/\\]\.config[/\\]zsh[/\\]/.test(sourcePath);
  },
  parse: (content: string, ctx: ParserContext): Entry[] => {
    const entries: Entry[] = [];
    const lines = content.split('\n');

    // Section tracker. Updated whenever a SECTION_HEADER_RE comment
    // fires; persists across non-matching comments and code lines
    // until the next header. Not reset by blank lines — it's common
    // to separate a section from its contents with a newline.
    let currentSection: string | null = null;

    lines.forEach((rawLine, index) => {
      const line = rawLine.trimEnd();
      if (line.length === 0) return;

      if (LINE_COMMENT_RE.test(line)) {
        const headerMatch = line.match(SECTION_HEADER_RE);
        if (headerMatch) currentSection = headerMatch[1].trim();
        return;
      }

      const { code, comment } = splitCommentTrailing(line);

      if (BINDKEY_RE.test(code)) {
        const entry = parseBindkey(code, index, ctx, comment, currentSection);
        if (entry) entries.push(entry);
        return;
      }

      if (ALIAS_RE.test(code)) {
        const entry = parseAlias(code, index, ctx, comment, currentSection);
        if (entry) entries.push(entry);
        return;
      }

      if (FUNCTION_KEYWORD_RE.test(code) || POSIX_FUNCTION_RE.test(code)) {
        const entry = parseFunction(code, index, ctx, comment, currentSection);
        if (entry) entries.push(entry);
      }
    });

    return entries;
  },
};
