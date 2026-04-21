import type { Entry, Parser, ParserContext } from '../types.js';

/**
 * Parse `bind-key` / `bind` statements from a tmux config.
 *
 * Supported line shapes:
 *   bind r source-file ~/.tmux.conf
 *   bind-key -r h select-pane -L  # navigate left
 *   bind -n M-Left previous-window
 *   bind -T copy-mode-vi v send -X begin-selection
 *
 * Skipped:
 *   - comment-only lines (`# ...`) and empty lines
 *   - `unbind` / `unbind-key` (these remove bindings, not add them)
 *   - mode-switch / option statements (`set`, `setw`) — not keybinds
 *
 * The trailing `# comment` (when present on the same physical line) is
 * promoted to the Entry action. When absent the command itself is used
 * as the action — less friendly but always truthful.
 *
 * Not handled in v1 (deferred):
 *   - continuation lines (`\` at end) — rare in practice, punted
 *   - `-N "note"` flag (tmux 3.1+ note syntax) — falls through to the
 *     command action; can be promoted in a follow-up
 */

const BIND_RE = /^\s*(?:bind-key|bind)\b/;

/**
 * Strip short flags from the front of a post-keyword slice, in order.
 * `-T <table>` / `-N <note>` take a following argument; other short
 * flags (`-r`, `-n`) stand alone. Returns the rest after all flags
 * have been consumed.
 */
const stripLeadingFlags = (slice: string): string => {
  let rest = slice.trimStart();
  while (rest.startsWith('-')) {
    // `-T table`, `-N note` take an argument.
    const pair = rest.match(/^-[TN]\s+(\S+)\s*/);
    if (pair) {
      rest = rest.slice(pair[0].length);
      continue;
    }
    // Bare short flags (one letter, optionally clustered).
    const bare = rest.match(/^-[a-zA-Z]+\s+/);
    if (bare) {
      rest = rest.slice(bare[0].length);
      continue;
    }
    // Unknown flag shape — bail instead of chewing forever.
    break;
  }
  return rest;
};

const KEY_BIND_PREFIX_LABEL = 'Prefix';

const splitCommentTrailing = (line: string): { code: string; comment: string | null } => {
  // Naive split on ` #+ ` that ignores `#` embedded in quoted strings.
  // Accepts `#`, `##`, `###`... as the delimiter — some users use `##`
  // to visually distinguish "doc" comments from "note" comments.
  const match = line.match(/^(.*?)\s+#+\s*(.*)$/);
  if (!match) return { code: line, comment: null };
  const code = match[1];
  const comment = match[2].trim();
  // Skip the split if `#` is inside single or double quotes.
  const quoteCount = (code.match(/["']/g) ?? []).length;
  if (quoteCount % 2 !== 0) return { code: line, comment: null };
  return { code, comment: comment.length > 0 ? comment : null };
};

export const tmuxParser: Parser = {
  id: 'tmux',
  label: 'tmux',
  match: (sourcePath: string) => {
    return (
      sourcePath.endsWith('.tmux.conf') ||
      sourcePath.endsWith('/tmux.conf') ||
      sourcePath.endsWith('\\tmux.conf')
    );
  },
  parse: (content: string, ctx: ParserContext): Entry[] => {
    const entries: Entry[] = [];
    const lines = content.split('\n');
    lines.forEach((rawLine, index) => {
      const line = rawLine.trimEnd();
      if (line.length === 0) return;
      if (/^\s*#/.test(line)) return;
      if (!BIND_RE.test(line)) return;

      const { code, comment } = splitCommentTrailing(line);

      // Strip leading `bind-key` / `bind` + flags.
      const rest = stripLeadingFlags(code.replace(BIND_RE, ''));

      const match = rest.trim().match(/^(\S+)\s+(.+)$/);
      if (!match) return;
      const rawKey = match[1];
      const command = match[2].trim();

      const keybind = `${KEY_BIND_PREFIX_LABEL} + ${rawKey}`;
      const action = comment ?? command;

      entries.push({
        keybind,
        action,
        sourceFile: ctx.sourceFile,
        sourceLine: index + 1,
      });
    });
    return entries;
  },
};
