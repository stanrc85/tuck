import { describe, it, expect } from 'vitest';
import { validateJson } from '../../../src/lib/validators/json.js';

describe('validateJson', () => {
  it('returns no issues for valid JSON', () => {
    expect(validateJson('{"foo": 1, "bar": [2, 3]}')).toEqual([]);
  });

  it('flags syntax errors with line:col when available', () => {
    // Missing close brace on line 2.
    const bad = '{\n  "foo": 1';
    const issues = validateJson(bad);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message.toLowerCase()).toContain('json');
  });

  it('extracts line:col from `at position N` error messages', () => {
    const bad = '{"foo": }';
    const issues = validateJson(bad);
    expect(issues[0].line).toBe(1);
    expect(issues[0].column).toBeGreaterThan(1);
  });

  it('emits error with no line:col when the parser message is opaque', () => {
    // Non-JSON content — still caught but may or may not have a position.
    const issues = validateJson('not json at all');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
  });
});
