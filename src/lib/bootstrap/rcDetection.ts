import { basename } from 'path';

// Cache compiled token regexes — `containsToken` is called O(N×M) per
// restore (N candidate tools × M tokens). Re-compiling each call allocates
// without need; keep them around for the process lifetime. Tests that
// need a clean slate use `vi.resetModules()` which re-imports this file.
const tokenRegexCache = new Map<string, RegExp>();

/**
 * Word-boundary substring match. Returns true iff `token` appears in
 * `haystack` with non-word boundaries on both sides — `\bbat\b` in
 * "apt install bat" matches; in "combat" doesn't. Multi-word tokens
 * ("mise activate") work too — boundaries fire at the outer ends.
 *
 * Used by both `findMissingDeps` (rcReferences scan) and
 * `findUncoveredReferences` (rcReferences + binary/formula scan) so
 * both post-restore detectors agree on what counts as a hit. Substring
 * matching with plain `.includes()` would over-match on short tokens
 * (`fd` inside `xargs -fd`, `mise` inside `promise`).
 */
export const containsToken = (haystack: string, token: string): boolean => {
  let re = tokenRegexCache.get(token);
  if (!re) {
    // Escape regex metacharacters before composing the boundary match.
    // Defensive — current callers pass static strings without metachars,
    // but a future addition could regress silently otherwise.
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`\\b${escaped}\\b`);
    tokenRegexCache.set(token, re);
  }
  return re.test(haystack);
};

const SHELL_RC_BASENAMES = new Set([
  '.zshrc',
  '.zshenv',
  '.zprofile',
  '.zlogin',
  '.zlogout',
  '.bashrc',
  '.bash_profile',
  '.bash_login',
  '.profile',
  'config.fish',
]);

/**
 * True for paths that look like shell rc files — either by literal
 * basename (`.zshrc`, `.bashrc`, etc.) or by extension (`.zsh`, `.bash`,
 * `.sh`, `.fish`). Used to narrow content-scanning to files where
 * shell-keyword references are meaningful, avoiding false positives from
 * binary blobs or unrelated config that happens to contain short
 * substrings like "fzf" or "eza".
 *
 * Shared between `findMissingDeps` and `findUncoveredReferences` so both
 * post-restore scans agree on what counts as rc-shaped.
 */
export const isShellRcLikePath = (filePath: string): boolean => {
  const base = basename(filePath);
  if (SHELL_RC_BASENAMES.has(base)) return true;
  return /\.(zsh|bash|sh|fish)$/i.test(base);
};
