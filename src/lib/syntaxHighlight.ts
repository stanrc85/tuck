/**
 * Tiny regex-based syntax highlighter for `tuck diff` output.
 *
 * Design goals:
 *  - Zero runtime dependencies beyond chalk (already a dep via ui/theme).
 *  - Theme-respecting palette: every style is a chalk named ANSI color
 *    (cyan/yellow/blue/dim), which the terminal remaps through the user's
 *    color scheme. No RGB / hex / 256-color codes anywhere.
 *  - Single-line tokenization. Block comments that span multiple lines are
 *    NOT handled correctly — accepted trade-off for the "simple highlighter"
 *    scope. If users hit this, we'll switch to a real tokenizer.
 *
 * Algorithm:
 *   Priority-ordered rules with masking-between-passes. After each pass, the
 *   characters that got claimed are replaced with spaces in the working copy
 *   so the next pass can't re-match them. This lets strings absorb their
 *   contents (including `#` characters inside them) before comments scan,
 *   and prevents a comment keyword like `if` from being re-tokenized.
 */

import { c } from '../ui/theme.js';

type StyleFn = (s: string) => string;

interface HighlightRule {
  pattern: RegExp;
  style: StyleFn;
}

type LanguageRules = HighlightRule[];

interface Token {
  start: number;
  end: number;
  style: StyleFn;
}

// Palette — named colors only, so terminal themes apply.
const STYLE_STRING = c.yellow;
const STYLE_COMMENT = c.dim;
const STYLE_KEYWORD = c.blue;
const STYLE_NUMBER = c.cyan;
const STYLE_SECTION = c.blue; // TOML [section], YAML key
const STYLE_BOOLEAN = c.cyan;

const SHELL_KEYWORDS =
  /\b(if|then|else|elif|fi|for|while|until|do|done|case|esac|in|function|return|break|continue|exit|export|local|readonly|declare|typeset|source|set|unset|shift|eval|exec|trap|alias|echo|printf|read|test)\b/g;

const LUA_KEYWORDS =
  /\b(and|break|do|else|elseif|end|false|for|function|goto|if|in|local|nil|not|or|repeat|return|then|true|until|while)\b/g;

const DOUBLE_QUOTE_STRING = /"(?:\\.|[^"\\])*"/g;
const SINGLE_QUOTE_STRING = /'[^']*'/g;

// `#` starts a comment only when preceded by whitespace or start-of-line,
// so `${#array}` and `foo#bar` don't mis-tokenize.
const HASH_COMMENT = /(?:^|\s)#.*$/g;
// Lua line-end `--` comments; block comments `--[[ ... ]]` on a single line.
const LUA_BLOCK_COMMENT = /--\[\[[\s\S]*?\]\]/g;
const LUA_LINE_COMMENT = /--.*$/g;
const NUMBER_LITERAL = /\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;

const shellRules: LanguageRules = [
  { pattern: DOUBLE_QUOTE_STRING, style: STYLE_STRING },
  { pattern: SINGLE_QUOTE_STRING, style: STYLE_STRING },
  { pattern: HASH_COMMENT, style: STYLE_COMMENT },
  { pattern: SHELL_KEYWORDS, style: STYLE_KEYWORD },
  { pattern: /\b(true|false)\b/g, style: STYLE_BOOLEAN },
  { pattern: NUMBER_LITERAL, style: STYLE_NUMBER },
];

const jsonRules: LanguageRules = [
  { pattern: DOUBLE_QUOTE_STRING, style: STYLE_STRING },
  { pattern: /\b(true|false|null)\b/g, style: STYLE_BOOLEAN },
  { pattern: NUMBER_LITERAL, style: STYLE_NUMBER },
];

const yamlRules: LanguageRules = [
  { pattern: DOUBLE_QUOTE_STRING, style: STYLE_STRING },
  { pattern: SINGLE_QUOTE_STRING, style: STYLE_STRING },
  { pattern: HASH_COMMENT, style: STYLE_COMMENT },
  // Keys are the identifier before `:`. Must run before keywords so
  // `true:` as a key isn't coloured as a boolean.
  { pattern: /^\s*[A-Za-z_][\w-]*(?=\s*:)/gm, style: STYLE_SECTION },
  { pattern: /\b(true|false|null|yes|no|on|off)\b/gi, style: STYLE_BOOLEAN },
  { pattern: NUMBER_LITERAL, style: STYLE_NUMBER },
];

const tomlRules: LanguageRules = [
  { pattern: DOUBLE_QUOTE_STRING, style: STYLE_STRING },
  { pattern: SINGLE_QUOTE_STRING, style: STYLE_STRING },
  { pattern: HASH_COMMENT, style: STYLE_COMMENT },
  { pattern: /^\s*\[\[?[^\]]+\]\]?/gm, style: STYLE_SECTION },
  { pattern: /^\s*[A-Za-z_][\w-]*(?=\s*=)/gm, style: STYLE_SECTION },
  { pattern: /\b(true|false)\b/g, style: STYLE_BOOLEAN },
  { pattern: NUMBER_LITERAL, style: STYLE_NUMBER },
];

const luaRules: LanguageRules = [
  { pattern: DOUBLE_QUOTE_STRING, style: STYLE_STRING },
  { pattern: SINGLE_QUOTE_STRING, style: STYLE_STRING },
  { pattern: LUA_BLOCK_COMMENT, style: STYLE_COMMENT },
  { pattern: LUA_LINE_COMMENT, style: STYLE_COMMENT },
  { pattern: LUA_KEYWORDS, style: STYLE_KEYWORD },
  { pattern: NUMBER_LITERAL, style: STYLE_NUMBER },
];

const languages: Record<string, LanguageRules> = {
  shell: shellRules,
  json: jsonRules,
  yaml: yamlRules,
  toml: tomlRules,
  lua: luaRules,
};

/**
 * Resolve a source path to one of the supported language keys, or return
 * null if we don't have rules for it. Detection combines extension and
 * known dotfile basenames — `.zshrc` has no extension but is clearly shell.
 */
export const detectLanguage = (sourcePath: string): string | null => {
  const lower = sourcePath.toLowerCase();
  const basename = lower.split('/').pop() || '';

  if (/\.(sh|bash|zsh|ash|ksh|dash)$/.test(basename)) return 'shell';
  if (
    /^\.?(zshrc|zshenv|zprofile|zlogin|zlogout|bashrc|bash_profile|bash_login|bash_logout|profile|inputrc|kshrc|aliases|exports|functions|env)$/.test(
      basename
    )
  )
    return 'shell';

  if (basename.endsWith('.json') || basename.endsWith('.jsonc')) return 'json';
  if (/\.(yaml|yml)$/.test(basename)) return 'yaml';
  if (basename.endsWith('.toml')) return 'toml';
  if (/^\.?tuckrc(\..+)?$/.test(basename)) return 'toml';
  if (basename.endsWith('.lua')) return 'lua';

  return null;
};

const tokenize = (line: string, rules: LanguageRules): Token[] => {
  const tokens: Token[] = [];
  let masked = line;
  for (const rule of rules) {
    // Rebuild with global flag so exec() iterates; preserve others.
    const flags = rule.pattern.flags.includes('g')
      ? rule.pattern.flags
      : rule.pattern.flags + 'g';
    const re = new RegExp(rule.pattern.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (end === start) {
        // Zero-width match: advance manually or we loop forever.
        re.lastIndex++;
        continue;
      }
      // Skip if any earlier rule already claimed part of this span.
      if (tokens.some((t) => start < t.end && end > t.start)) continue;
      tokens.push({ start, end, style: rule.style });
    }

    // Mask the characters this rule claimed so the next rule can't see them.
    if (tokens.length > 0) {
      const chars = [...masked];
      for (const t of tokens) {
        for (let i = t.start; i < t.end; i++) chars[i] = ' ';
      }
      masked = chars.join('');
    }
  }
  return tokens;
};

/**
 * Apply syntax highlighting to a single line. If the source path isn't a
 * recognised language, returns the line unchanged so the caller's diff
 * colors (red/green wrapping) are the final output.
 */
export const highlightLine = (line: string, sourcePath: string): string => {
  const lang = detectLanguage(sourcePath);
  if (!lang) return line;
  const rules = languages[lang];
  const tokens = tokenize(line, rules).sort((a, b) => a.start - b.start);
  if (tokens.length === 0) return line;

  let out = '';
  let pos = 0;
  for (const t of tokens) {
    if (t.start > pos) out += line.slice(pos, t.start);
    out += t.style(line.slice(t.start, t.end));
    pos = t.end;
  }
  if (pos < line.length) out += line.slice(pos);
  return out;
};
