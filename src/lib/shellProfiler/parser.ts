// Parser for zsh xtrace output profiled with the PS4 format used by runner.ts:
//
//   PS4='+%D{%s.%6.}|%N|%i> '
//
// Each line emitted by xtrace looks like `+1707000000.123456|.zshrc|42> cmd`.
// The `|` delimiter avoids collisions with paths and command text. Deltas
// between consecutive timestamps attribute wall-clock time to the previous
// source:line — exactly like `zsh/zprof` but implemented in a few dozen
// lines so we can unit-test the parser without spawning a shell.

export interface ProfileEvent {
  timestampMs: number; // fractional milliseconds from zsh's %D{%s.%6.}
  sourceFile: string;  // %N — script / sourced file / function name
  line: number;        // %i — line number being executed
  command: string;     // the text after `> `
}

export interface PerFileTotal {
  file: string;
  totalMs: number;
  eventCount: number;
}

export interface ProfileReport {
  events: ProfileEvent[];
  perFile: PerFileTotal[];
  totalMs: number;
}

const EVENT_RE = /^\+([\d.]+)\|([^|]*)\|(\d+)>\s?(.*)$/;

export const parseXtrace = (raw: string): ProfileReport => {
  const events: ProfileEvent[] = [];
  for (const line of raw.split('\n')) {
    const match = EVENT_RE.exec(line);
    if (!match) continue;
    const timestampSec = parseFloat(match[1]);
    if (!Number.isFinite(timestampSec)) continue;
    events.push({
      timestampMs: timestampSec * 1000,
      sourceFile: match[2],
      line: parseInt(match[3], 10),
      command: match[4],
    });
  }

  const fileAccumulator = new Map<string, { totalMs: number; eventCount: number }>();
  let totalMs = 0;

  // Attribute each delta to the event that started it — the time spent
  // executing that command. The last event has no successor, so its cost
  // is unknown; we don't inflate earlier numbers to compensate.
  for (let i = 0; i < events.length - 1; i++) {
    const current = events[i];
    const next = events[i + 1];
    const delta = Math.max(0, next.timestampMs - current.timestampMs);
    totalMs += delta;
    const existing = fileAccumulator.get(current.sourceFile) ?? { totalMs: 0, eventCount: 0 };
    existing.totalMs += delta;
    existing.eventCount++;
    fileAccumulator.set(current.sourceFile, existing);
  }

  const perFile: PerFileTotal[] = [...fileAccumulator.entries()]
    .map(([file, v]) => ({ file, totalMs: v.totalMs, eventCount: v.eventCount }))
    .sort((a, b) => b.totalMs - a.totalMs);

  return { events, perFile, totalMs };
};
