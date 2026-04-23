import { describe, it, expect } from 'vitest';
import { parseXtrace } from '../../../src/lib/shellProfiler/parser.js';

describe('parseXtrace', () => {
  it('parses event lines with timestamp, file, line, and command', () => {
    const raw = [
      '+1707000000.000000|.zshrc|1> echo hello',
      '+1707000000.050000|.zshrc|2> export PATH=$HOME/bin',
    ].join('\n');
    const report = parseXtrace(raw);
    expect(report.events).toHaveLength(2);
    expect(report.events[0].sourceFile).toBe('.zshrc');
    expect(report.events[0].line).toBe(1);
    expect(report.events[0].command).toBe('echo hello');
    expect(report.events[0].timestampMs).toBeCloseTo(1707000000000, 0);
    expect(report.events[1].timestampMs).toBeCloseTo(1707000000050, 0);
  });

  it('ignores non-event lines (verbose echoes, plain output)', () => {
    const raw = [
      'echo hello',
      'hello',
      '+1707000000.000000|.zshrc|1> echo hello',
      'some random output',
    ].join('\n');
    expect(parseXtrace(raw).events).toHaveLength(1);
  });

  it('attributes delta time to the event that started it', () => {
    const raw = [
      '+1707000000.000000|a.zsh|1> slow-cmd',
      '+1707000000.100000|a.zsh|2> fast-cmd',
      '+1707000000.105000|b.zsh|1> final',
    ].join('\n');
    const report = parseXtrace(raw);
    // Delta 0→1: 100ms attributed to a.zsh:1. Delta 1→2: 5ms attributed to a.zsh:2.
    // b.zsh has no successor → 0ms attributed.
    const a = report.perFile.find((f) => f.file === 'a.zsh');
    const b = report.perFile.find((f) => f.file === 'b.zsh');
    expect(a?.totalMs).toBeCloseTo(105, 1);
    expect(b).toBeUndefined();
    expect(report.totalMs).toBeCloseTo(105, 1);
  });

  it('sorts perFile descending by totalMs', () => {
    const raw = [
      '+1707000000.000000|slow.zsh|1> x',
      '+1707000000.500000|fast.zsh|1> y',
      '+1707000000.510000|end.zsh|1> z',
    ].join('\n');
    const report = parseXtrace(raw);
    expect(report.perFile[0].file).toBe('slow.zsh');
    expect(report.perFile[0].totalMs).toBeGreaterThan(report.perFile[1].totalMs);
  });

  it('returns an empty report for empty input', () => {
    const report = parseXtrace('');
    expect(report.events).toEqual([]);
    expect(report.perFile).toEqual([]);
    expect(report.totalMs).toBe(0);
  });
});
