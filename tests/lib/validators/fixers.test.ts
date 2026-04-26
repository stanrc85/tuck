import { describe, it, expect } from 'vitest';
import { computeFixes, renderFixDiff } from '../../../src/lib/validators/fixers.js';

describe('computeFixes', () => {
  it('returns null when content is already clean', () => {
    expect(computeFixes('~/.file', '/abs/.file', 'a\nb\n')).toBeNull();
  });

  it('returns null for empty content (no EOF newline needed)', () => {
    expect(computeFixes('~/.file', '/abs/.file', '')).toBeNull();
  });

  it('strips trailing whitespace', () => {
    const result = computeFixes('~/.file', '/abs/.file', 'line one   \nline two\n');
    expect(result).not.toBeNull();
    expect(result!.after).toBe('line one\nline two\n');
    expect(result!.fixes.some((f) => f.includes('trailing whitespace'))).toBe(true);
  });

  it('adds a missing EOF newline', () => {
    const result = computeFixes('~/.file', '/abs/.file', 'line one\nline two');
    expect(result).not.toBeNull();
    expect(result!.after).toBe('line one\nline two\n');
    expect(result!.fixes.some((f) => f.includes('EOF newline'))).toBe(true);
  });

  it('combines both fixes in one proposal', () => {
    const result = computeFixes('~/.file', '/abs/.file', 'a   \nb   ');
    expect(result).not.toBeNull();
    expect(result!.after).toBe('a\nb\n');
    expect(result!.fixes.length).toBe(2);
  });

  it('reports line count accurately when only some lines have trailing whitespace', () => {
    const result = computeFixes(
      '~/.file',
      '/abs/.file',
      'clean\ndirty   \nclean\ndirty2  \n',
    );
    expect(result!.fixes[0]).toMatch(/2 lines/);
  });
});

describe('computeFixes - JSON pretty-print', () => {
  it('returns null when JSON is already pretty-printed', () => {
    const pretty = '{\n  "foo": 1,\n  "bar": [\n    2,\n    3\n  ]\n}\n';
    expect(computeFixes('~/.config/x.json', '/abs/x.json', pretty)).toBeNull();
  });

  it('reformats compact JSON with 2-space indent + EOF newline', () => {
    const result = computeFixes('~/.config/x.json', '/abs/x.json', '{"foo":1,"bar":[2,3]}');
    expect(result).not.toBeNull();
    expect(result!.after).toBe('{\n  "foo": 1,\n  "bar": [\n    2,\n    3\n  ]\n}\n');
    expect(result!.fixes.some((f) => f.toLowerCase().includes('json'))).toBe(true);
  });

  it('falls through to whitespace fixer on JSON files that do not parse', () => {
    // Invalid JSON — pretty-print can't run. The line-level fixer should still
    // catch the trailing whitespace so the user gets some auto-fix value while
    // they manually resolve the syntax error (which `validate` reports).
    const result = computeFixes('~/.config/x.json', '/abs/x.json', '{"foo": }   \n');
    expect(result).not.toBeNull();
    expect(result!.fixes.some((f) => f.includes('trailing whitespace'))).toBe(true);
  });

  it('does not pretty-print non-JSON files even if they happen to parse as JSON', () => {
    // A `.zshrc` containing `{}` as a literal — pretty-print would treat it as
    // valid JSON and rewrite the whole file. Detect-by-extension prevents that.
    const result = computeFixes('~/.zshrc', '/abs/.zshrc', '{}\n');
    expect(result).toBeNull();
  });
});

describe('renderFixDiff', () => {
  const stripAnsi = (s: string): string =>
    // eslint-disable-next-line no-control-regex
    s.replace(/\x1b\[[0-9;]*m/g, '');

  it('renders a minus line for the old row + plus line for the new row', () => {
    const proposal = computeFixes('~/.file', '/abs/.file', 'keep\nedit   \n')!;
    const out = stripAnsi(renderFixDiff(proposal));
    expect(out).toContain('- edit   ');
    expect(out).toContain('+ edit');
  });

  it('includes --- / +++ headers with the source path', () => {
    const proposal = computeFixes('~/.file', '/abs/.file', 'a\nb   \n')!;
    const out = stripAnsi(renderFixDiff(proposal));
    expect(out).toContain('--- a/~/.file');
    expect(out).toContain('+++ b/~/.file');
  });
});
