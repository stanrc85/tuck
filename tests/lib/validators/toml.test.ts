import { describe, it, expect } from 'vitest';
import { validateToml } from '../../../src/lib/validators/toml.js';

describe('validateToml', () => {
  it('returns no issues for valid TOML', () => {
    expect(validateToml('[section]\nkey = "value"\nnum = 42\n')).toEqual([]);
  });

  it('flags syntax errors', () => {
    // Trailing `=` with no value.
    const issues = validateToml('[section]\nkey =\n');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].severity).toBe('error');
  });

  it('surfaces line number when the parser provides it', () => {
    const issues = validateToml('[section]\n\n\nkey without equals\n');
    expect(issues.length).toBeGreaterThan(0);
    // smol-toml attaches line numbers when it can; accept either shape here
    // since exact line depends on internal parser state.
    if (issues[0].line !== undefined) {
      expect(issues[0].line).toBeGreaterThanOrEqual(1);
    }
  });
});
