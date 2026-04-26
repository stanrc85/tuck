import { describe, it, expect } from 'vitest';
import { validateYaml } from '../../../src/lib/validators/yaml.js';

describe('validateYaml', () => {
  it('returns no issues for valid YAML', () => {
    expect(
      validateYaml(['root:', '  key: value', '  list:', '    - one', '    - two', ''].join('\n')),
    ).toEqual([]);
  });

  it('returns no issues for empty input', () => {
    expect(validateYaml('')).toEqual([]);
  });

  it('flags an indentation error with line:col when available', () => {
    // Tab-indented child under spaces — strict YAML rejects this.
    const bad = ['root:', '\tkey: value'].join('\n');
    const issues = validateYaml(bad);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    if (issues[0].line !== undefined) {
      expect(issues[0].line).toBeGreaterThan(0);
    }
  });

  it('flags a duplicate-key conflict', () => {
    // Same key twice in the same map — yaml lib treats this as an error in
    // strict mode (default).
    const bad = ['root:', '  k: 1', '  k: 2'].join('\n');
    const issues = validateYaml(bad);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].severity).toBe('error');
  });

  it('flags an unclosed flow sequence', () => {
    // Flow-style list missing its closing bracket — surfaces as a parse error.
    const bad = 'list: [a, b, c';
    const issues = validateYaml(bad);
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues[0].severity).toBe('error');
  });
});
