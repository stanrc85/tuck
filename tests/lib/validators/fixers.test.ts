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
