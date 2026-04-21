import type { Entry, Parser, ParserContext } from '../types.js';

/**
 * Parse `bindkey` and `alias` statements from a zsh config.
 *
 * Two sub-formats, handled in the same pass:
 *
 *   bindkey '^R' history-incremental-search-backward
 *   bindkey "^[[A" up-line-or-history
 *
 *   alias ll='ls -la'
 *   alias g=git
 *   alias -g ...G='| grep'   # global alias — captured, category=alias
 *
 * Skipped:
 *   - comment-only lines and empty lines
 *   - mode-switch `bindkey -e` / `bindkey -v` (no binding, just options)
 *   - `unalias` (removes, not adds)
 *
 * Entries from aliases carry `category: 'alias'` to distinguish them
 * from keybinds when `--group-by category` ships. The v1 renderer
 * ignores the category and groups everything under the `zsh` section.
 */

const LINE_COMMENT_RE = /^\s*#/;

const BINDKEY_RE = /^\s*bindkey\s+/;
const ALIAS_RE = /^\s*alias\s+/;

/**
 * Strip a trailing `# comment` that isn't inside quotes. Conservative —
 * we only drop when the count of unescaped single+double quotes before
 * the `#` is even (i.e. not mid-string). Good enough for real-world
 * zshrc lines, which rarely embed `#` inside a quoted alias body.
 */
const stripTrailingComment = (line: string): string => {
  const idx = line.search(/\s#/);
  if (idx < 0) return line;
  const before = line.slice(0, idx);
  const quotes = (before.match(/(?<!\\)["']/g) ?? []).length;
  if (quotes % 2 !== 0) return line;
  return before.trimEnd();
};

const parseBindkey = (
  line: string,
  index: number,
  ctx: ParserContext
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
    action: widget,
    sourceFile: ctx.sourceFile,
    sourceLine: index + 1,
  };
};

const parseAlias = (
  line: string,
  index: number,
  ctx: ParserContext
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
    action: value,
    sourceFile: ctx.sourceFile,
    sourceLine: index + 1,
    category: 'alias',
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

    lines.forEach((rawLine, index) => {
      const line = rawLine.trimEnd();
      if (line.length === 0) return;
      if (LINE_COMMENT_RE.test(line)) return;

      const stripped = stripTrailingComment(line);

      if (BINDKEY_RE.test(stripped)) {
        const entry = parseBindkey(stripped, index, ctx);
        if (entry) entries.push(entry);
        return;
      }

      if (ALIAS_RE.test(stripped)) {
        const entry = parseAlias(stripped, index, ctx);
        if (entry) entries.push(entry);
      }
    });

    return entries;
  },
};
