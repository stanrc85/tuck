import { describe, it, expect } from 'vitest';
import { parseShellcheckOutput } from '../../../src/lib/validators/shell.js';

describe('parseShellcheckOutput', () => {
  it('parses gcc-format findings into ValidationIssue records', () => {
    const stdout = [
      '/home/u/.bashrc:14:5: warning: SC2086: Double quote to prevent globbing and word splitting.',
      '/home/u/.bashrc:22:1: error: SC1009: The mentioned syntax error was in this if expression.',
    ].join('\n');
    const issues = parseShellcheckOutput(stdout);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      line: 14,
      column: 5,
    });
    expect(issues[0].message).toContain('SC2086');
    expect(issues[1].severity).toBe('error');
    expect(issues[1].line).toBe(22);
  });

  it('demotes shellcheck `note` severity to warning', () => {
    const stdout = '/home/u/.bashrc:1:1: note: SC2148: Tips depend on target shell.';
    const issues = parseShellcheckOutput(stdout);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('ignores non-finding lines (banners, blanks, debug noise)', () => {
    const stdout = [
      '',
      'Some unrelated banner line',
      '/home/u/.bashrc:5:1: warning: SC2034: VAR appears unused.',
      '   ',
    ].join('\n');
    expect(parseShellcheckOutput(stdout)).toHaveLength(1);
  });

  it('returns empty list for empty stdout', () => {
    expect(parseShellcheckOutput('')).toEqual([]);
  });
});
