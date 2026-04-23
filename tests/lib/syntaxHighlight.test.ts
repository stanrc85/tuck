import { describe, it, expect } from 'vitest';
import chalk from 'chalk';
// Vitest captures stdout so chalk's TTY detection disables output. Force
// ANSI emission so the assertions below actually see color codes — the
// production runtime re-detects against the user's terminal normally.
chalk.level = 2;
import { detectLanguage, highlightLine } from '../../src/lib/syntaxHighlight.js';

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

// Quick check that a substring is wrapped in at least one ANSI SGR code.
// We don't care which specific color — just that the tokenizer claimed it.
const isStyled = (haystack: string, needle: string): boolean => {
  // eslint-disable-next-line no-control-regex
  const pattern = new RegExp(`\x1b\\[[0-9;]+m${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\x1b\\[[0-9;]+m`);
  return pattern.test(haystack);
};

describe('detectLanguage', () => {
  it.each([
    ['/.zshrc', 'shell'],
    ['/.bashrc', 'shell'],
    ['/.zprofile', 'shell'],
    ['~/scripts/install.sh', 'shell'],
    ['~/scripts/build.bash', 'shell'],
    ['/tuck.config.json', 'json'],
    ['/package.json', 'json'],
    ['.github/workflows/ci.yml', 'yaml'],
    ['~/.gitlab-ci.yaml', 'yaml'],
    ['/bootstrap.toml', 'toml'],
    ['~/.tuckrc', 'toml'],
    ['~/.tuckrc.local.json', 'json'], // .json wins over the tuckrc prefix check because basename ends with .json
    ['~/.config/nvim/init.lua', 'lua'],
  ])('detects %s as %s', (path, expected) => {
    expect(detectLanguage(path)).toBe(expected);
  });

  it('returns null for unknown extensions', () => {
    expect(detectLanguage('~/some-binary')).toBeNull();
    expect(detectLanguage('~/random.xyz')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(detectLanguage('/.ZSHRC')).toBe('shell');
    expect(detectLanguage('/PACKAGE.JSON')).toBe('json');
  });
});

describe('highlightLine — shell', () => {
  it('styles string literals and keywords', () => {
    const out = highlightLine('if [[ "$FOO" == "bar" ]]; then echo hi; fi', '~/.zshrc');
    // `if`, `then`, `fi` are keywords; `"bar"` and `"$FOO"` are strings.
    expect(isStyled(out, 'if')).toBe(true);
    expect(isStyled(out, 'then')).toBe(true);
    expect(isStyled(out, '"bar"')).toBe(true);
    expect(stripAnsi(out)).toBe('if [[ "$FOO" == "bar" ]]; then echo hi; fi');
  });

  it('styles line comments', () => {
    const out = highlightLine('export PATH=/usr/bin # set path', '~/.zshrc');
    expect(isStyled(out, 'export')).toBe(true);
    // Comment includes the leading space per the (?:^|\s)# anchor
    expect(out).toMatch(/\x1b\[[0-9;]+m[^\x1b]*# set path/); // eslint-disable-line no-control-regex
  });

  it('does not treat `#` inside a string as a comment', () => {
    const out = highlightLine('echo "color #ff8800 is orange"', '~/.zshrc');
    expect(isStyled(out, '"color #ff8800 is orange"')).toBe(true);
    // No extra comment styling on the tail because the whole `"..."` was claimed first.
    expect(stripAnsi(out)).toBe('echo "color #ff8800 is orange"');
  });

  it('does not comment-tokenise `${#var}` parameter expansions', () => {
    const out = highlightLine('echo ${#PATH}', '~/.zshrc');
    // The `#` here is preceded by `{`, not whitespace — not a comment.
    // It's also not inside a string. Neither a comment nor a string claims it.
    expect(stripAnsi(out)).toBe('echo ${#PATH}');
  });
});

describe('highlightLine — json', () => {
  it('styles strings, numbers, and booleans', () => {
    const out = highlightLine('"name": "tuck", "version": 2, "active": true', '/tuck.json');
    expect(isStyled(out, '"name"')).toBe(true);
    expect(isStyled(out, '"tuck"')).toBe(true);
    expect(isStyled(out, '2')).toBe(true);
    expect(isStyled(out, 'true')).toBe(true);
  });

  it('styles null literal', () => {
    const out = highlightLine('"value": null', '/config.json');
    expect(isStyled(out, 'null')).toBe(true);
  });
});

describe('highlightLine — yaml', () => {
  it('styles keys, strings, and comments', () => {
    const out = highlightLine('name: "tuck"  # display name', '.github/workflows/ci.yml');
    expect(isStyled(out, 'name')).toBe(true);
    expect(isStyled(out, '"tuck"')).toBe(true);
    // The comment includes the leading space
    expect(out).toMatch(/\x1b\[[0-9;]+m[^\x1b]*# display name/); // eslint-disable-line no-control-regex
  });

  it('styles booleans and null', () => {
    const out = highlightLine('enabled: true', '/config.yml');
    expect(isStyled(out, 'true')).toBe(true);
  });
});

describe('highlightLine — toml', () => {
  it('styles section headers', () => {
    const out = highlightLine('[repository]', '~/.tuckrc');
    expect(out).toMatch(/\x1b\[[0-9;]+m\[repository\]/); // eslint-disable-line no-control-regex
  });

  it('styles keys and values', () => {
    const out = highlightLine('defaultBranch = "main"', '/config.toml');
    expect(isStyled(out, 'defaultBranch')).toBe(true);
    expect(isStyled(out, '"main"')).toBe(true);
  });
});

describe('highlightLine — lua', () => {
  it('styles line comments, strings, and keywords', () => {
    const out = highlightLine('local foo = "bar" -- a note', '~/.config/nvim/init.lua');
    expect(isStyled(out, 'local')).toBe(true);
    expect(isStyled(out, '"bar"')).toBe(true);
    expect(out).toMatch(/\x1b\[[0-9;]+m-- a note/); // eslint-disable-line no-control-regex
  });

  it('styles block comments on a single line', () => {
    const out = highlightLine('x = 1 --[[ block ]] y = 2', '~/script.lua');
    expect(out).toMatch(/\x1b\[[0-9;]+m--\[\[ block \]\]/); // eslint-disable-line no-control-regex
  });
});

describe('highlightLine — no-op cases', () => {
  it('returns the line unchanged for unknown extensions', () => {
    const out = highlightLine('whatever content', '~/mystery.bin');
    expect(out).toBe('whatever content');
  });

  it('returns the line unchanged when no tokens match', () => {
    const out = highlightLine('just some prose here', '~/.zshrc');
    // No keywords / strings / comments / numbers — plain pass-through.
    expect(out).toBe('just some prose here');
  });

  it('preserves the original content when stripped of ANSI', () => {
    const input = 'function greet() { echo "hello" }';
    const out = highlightLine(input, '~/.zshrc');
    expect(stripAnsi(out)).toBe(input);
  });
});
