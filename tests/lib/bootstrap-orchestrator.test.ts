import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vol } from 'memfs';
import { EventEmitter } from 'events';
import { join } from 'path';
import type { spawn as spawnFn } from 'child_process';
import {
  planBootstrap,
  executeBootstrap,
  type ToolOutcome,
} from '../../src/lib/bootstrap/orchestrator.js';
import type { ToolDefinition } from '../../src/schemas/bootstrap.schema.js';
import type { BootstrapVars } from '../../src/lib/bootstrap/interpolator.js';
import { BootstrapError } from '../../src/errors.js';
import { loadBootstrapState, STATE_FILE } from '../../src/lib/bootstrap/state.js';
import { TEST_TUCK_DIR } from '../setup.js';

const baseVars: Omit<BootstrapVars, 'VERSION'> = {
  ARCH: 'amd64',
  HOME: '/test-home',
  OS: 'linux',
  TUCK_DIR: TEST_TUCK_DIR,
};

const tool = (id: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id,
  description: `desc for ${id}`,
  install: `install-${id}`,
  requires: [],
  detect: { paths: [], rcReferences: [] },
  ...overrides,
});

/**
 * Matcher-driven fake spawn. Each call consults the rules in order;
 * the first matcher that returns true is used and consumed isn't — the
 * same rule can fire multiple times.
 */
interface SpawnRule {
  match: (cmd: string, args: readonly string[]) => boolean;
  exitCode: number;
}

const makeSpawnMock = (rules: SpawnRule[]): { spawn: typeof spawnFn; calls: Array<{ cmd: string; args: readonly string[] }> } => {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const impl = (cmd: string, args: readonly string[]) => {
    calls.push({ cmd, args });
    const rule = rules.find((r) => r.match(cmd, args));
    if (!rule) {
      throw new Error(`unexpected spawn call: ${cmd} ${args.join(' ')}`);
    }
    const emitter = new EventEmitter() as EventEmitter & { stdout: null; stderr: null };
    emitter.stdout = null;
    emitter.stderr = null;
    queueMicrotask(() => emitter.emit('close', rule.exitCode, null));
    return emitter;
  };
  return { spawn: impl as unknown as typeof spawnFn, calls };
};

describe('planBootstrap', () => {
  it('returns an empty plan for an empty selection', () => {
    const plan = planBootstrap({ catalog: [tool('a'), tool('b')], selectedIds: [] });
    expect(plan.ordered).toEqual([]);
    expect(plan.implied).toEqual([]);
    expect(plan.unknown).toEqual([]);
  });

  it('plans a single tool with no deps', () => {
    const plan = planBootstrap({
      catalog: [tool('pet'), tool('fzf')],
      selectedIds: ['pet'],
    });
    expect(plan.ordered.map((t) => t.id)).toEqual(['pet']);
    expect(plan.implied).toEqual([]);
  });

  it('pulls in dependencies transparently and tags them as implied', () => {
    const plan = planBootstrap({
      catalog: [tool('pet', { requires: ['fzf'] }), tool('fzf'), tool('eza')],
      selectedIds: ['pet'],
    });
    expect(plan.ordered.map((t) => t.id)).toEqual(['fzf', 'pet']);
    expect(plan.implied).toEqual(['fzf']);
  });

  it('preserves direct picks even when they are also implied by other picks', () => {
    const plan = planBootstrap({
      catalog: [tool('pet', { requires: ['fzf'] }), tool('fzf')],
      selectedIds: ['pet', 'fzf'],
    });
    expect(plan.ordered.map((t) => t.id)).toEqual(['fzf', 'pet']);
    expect(plan.implied).toEqual([]);
  });

  it('collects unknown ids without throwing', () => {
    const plan = planBootstrap({
      catalog: [tool('pet')],
      selectedIds: ['pet', 'ghost', 'mystery'],
    });
    expect(plan.ordered.map((t) => t.id)).toEqual(['pet']);
    expect(plan.unknown.sort()).toEqual(['ghost', 'mystery']);
  });

  it('resolves multi-level dep chains in topological order', () => {
    const plan = planBootstrap({
      catalog: [
        tool('a', { requires: ['b'] }),
        tool('b', { requires: ['c'] }),
        tool('c'),
      ],
      selectedIds: ['a'],
    });
    expect(plan.ordered.map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });

  it('throws when catalog has a cycle inside the closure', () => {
    expect(() =>
      planBootstrap({
        catalog: [
          tool('a', { requires: ['b'] }),
          tool('b', { requires: ['a'] }),
        ],
        selectedIds: ['a'],
      })
    ).toThrowError(BootstrapError);
  });

  it('throws when a tool requires an id missing from the catalog', () => {
    expect(() =>
      planBootstrap({
        catalog: [tool('a', { requires: ['missing'] })],
        selectedIds: ['a'],
      })
    ).toThrowError(BootstrapError);
  });
});

describe('executeBootstrap', () => {
  beforeEach(() => {
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
  });

  it('runs install when no check is defined and records state', async () => {
    const { spawn, calls } = makeSpawnMock([{ match: () => true, exitCode: 0 }]);
    const plan = planBootstrap({ catalog: [tool('pet')], selectedIds: ['pet'] });

    const result = await executeBootstrap({
      plan,
      vars: baseVars,
      runOptions: { spawnImpl: spawn, log: () => {} },
      tuckDir: TEST_TUCK_DIR,
    });

    expect(result.counts).toEqual({ installed: 1, failed: 0, skipped: 0 });
    expect(result.outcomes[0]?.status).toBe('installed');
    expect(calls[0]?.cmd).toBe('bash');

    const state = await loadBootstrapState(TEST_TUCK_DIR);
    expect(state.tools.pet?.definitionHash).toMatch(/^sha256:/);
  });

  it('skips install when check returns 0', async () => {
    const { spawn, calls } = makeSpawnMock([{ match: () => true, exitCode: 0 }]);
    const plan = planBootstrap({
      catalog: [tool('pet', { check: 'command -v pet' })],
      selectedIds: ['pet'],
    });

    const result = await executeBootstrap({
      plan,
      vars: baseVars,
      runOptions: { spawnImpl: spawn, log: () => {} },
      tuckDir: TEST_TUCK_DIR,
    });

    expect(result.counts).toEqual({ installed: 0, failed: 0, skipped: 1 });
    expect(result.outcomes[0]?.status).toBe('skipped-already-installed');
    // Only the check should have spawned — no install.
    expect(calls).toHaveLength(1);
  });

  it('runs install after a failing check', async () => {
    // Two sequential spawn calls: check (exits 1) then install (exits 0).
    let callCount = 0;
    const { spawn } = makeSpawnMock([
      {
        match: () => true,
        exitCode: 0,
      },
    ]);
    // Override with a sequenced mock for this test.
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const sequencedSpawn = ((cmd: string, args: readonly string[]) => {
      calls.push({ cmd, args });
      const code = callCount++ === 0 ? 1 : 0;
      const emitter = new EventEmitter() as EventEmitter & { stdout: null; stderr: null };
      emitter.stdout = null;
      emitter.stderr = null;
      queueMicrotask(() => emitter.emit('close', code, null));
      return emitter;
    }) as unknown as typeof spawnFn;
    void spawn;

    const plan = planBootstrap({
      catalog: [tool('pet', { check: 'command -v pet' })],
      selectedIds: ['pet'],
    });

    const result = await executeBootstrap({
      plan,
      vars: baseVars,
      runOptions: { spawnImpl: sequencedSpawn, log: () => {} },
      tuckDir: TEST_TUCK_DIR,
    });

    expect(calls).toHaveLength(2);
    expect(result.counts.installed).toBe(1);
  });

  it('force set bypasses the check phase', async () => {
    const { spawn, calls } = makeSpawnMock([{ match: () => true, exitCode: 0 }]);
    const plan = planBootstrap({
      catalog: [tool('pet', { check: 'command -v pet' })],
      selectedIds: ['pet'],
    });

    const result = await executeBootstrap({
      plan,
      vars: baseVars,
      force: new Set(['pet']),
      runOptions: { spawnImpl: spawn, log: () => {} },
      tuckDir: TEST_TUCK_DIR,
    });

    expect(calls).toHaveLength(1); // install only, no check
    expect(calls[0]?.args[1]).toBe('install-pet');
    expect(result.outcomes[0]?.status).toBe('installed');
  });

  it('records a failed install without updating state', async () => {
    const { spawn } = makeSpawnMock([{ match: () => true, exitCode: 42 }]);
    const plan = planBootstrap({ catalog: [tool('pet')], selectedIds: ['pet'] });

    const result = await executeBootstrap({
      plan,
      vars: baseVars,
      runOptions: { spawnImpl: spawn, log: () => {} },
      tuckDir: TEST_TUCK_DIR,
    });

    expect(result.counts).toEqual({ installed: 0, failed: 1, skipped: 0 });
    expect(result.outcomes[0]).toEqual({ id: 'pet', status: 'failed', exitCode: 42 });

    // State file must not be created for a failed install.
    expect(vol.existsSync(join(TEST_TUCK_DIR, STATE_FILE))).toBe(false);
  });

  it('marks dependents as skipped-dep-failed when a dep fails', async () => {
    // catalog: a (no deps), b (requires a). a fails → b must skip.
    const { spawn, calls } = makeSpawnMock([
      { match: (_, args) => String(args[1]).includes('install-a'), exitCode: 1 },
      { match: () => true, exitCode: 0 },
    ]);
    const plan = planBootstrap({
      catalog: [tool('a'), tool('b', { requires: ['a'] })],
      selectedIds: ['b'],
    });

    const result = await executeBootstrap({
      plan,
      vars: baseVars,
      runOptions: { spawnImpl: spawn, log: () => {} },
      tuckDir: TEST_TUCK_DIR,
    });

    expect(result.counts).toEqual({ installed: 0, failed: 1, skipped: 1 });
    const byId = Object.fromEntries(result.outcomes.map((o) => [o.id, o.status]));
    expect(byId).toEqual({ a: 'failed', b: 'skipped-dep-failed' });
    // Only one spawn — b never launches because its dep failed.
    expect(calls).toHaveLength(1);
  });

  it('persist: false leaves the state file untouched on success', async () => {
    const { spawn } = makeSpawnMock([{ match: () => true, exitCode: 0 }]);
    const plan = planBootstrap({ catalog: [tool('pet')], selectedIds: ['pet'] });

    await executeBootstrap({
      plan,
      vars: baseVars,
      runOptions: { spawnImpl: spawn, log: () => {} },
      persist: false,
      tuckDir: TEST_TUCK_DIR,
    });

    expect(vol.existsSync(join(TEST_TUCK_DIR, STATE_FILE))).toBe(false);
  });

  it('fires onToolDone for every tool in the plan', async () => {
    const { spawn } = makeSpawnMock([{ match: () => true, exitCode: 0 }]);
    const plan = planBootstrap({
      catalog: [tool('a'), tool('b')],
      selectedIds: ['a', 'b'],
    });
    const seen: ToolOutcome[] = [];

    await executeBootstrap({
      plan,
      vars: baseVars,
      runOptions: { spawnImpl: spawn, log: () => {} },
      onToolDone: (o) => seen.push(o),
      tuckDir: TEST_TUCK_DIR,
    });

    expect(seen.map((o) => o.id)).toEqual(['a', 'b']);
    expect(seen.every((o) => o.status === 'installed')).toBe(true);
  });

  it('passes the tool.version through as ${VERSION} at install time', async () => {
    const { spawn, calls } = makeSpawnMock([{ match: () => true, exitCode: 0 }]);
    const plan = planBootstrap({
      catalog: [tool('pet', { version: '1.2.3', install: 'curl .../v${VERSION}/pet' })],
      selectedIds: ['pet'],
    });

    await executeBootstrap({
      plan,
      vars: baseVars,
      runOptions: { spawnImpl: spawn, log: () => {} },
      tuckDir: TEST_TUCK_DIR,
    });

    expect(calls[0]?.args[1]).toContain('v1.2.3');
  });

  it('counts aggregate across mixed outcomes in a single run', async () => {
    // a: installed, b: skipped by check, c: failed, d: dep-failed (requires c).
    let callIdx = 0;
    const sequencedSpawn = ((cmd: string, args: readonly string[]) => {
      const script = String(args[1]);
      callIdx += 1;
      let code: number;
      if (script === 'check-b') code = 0;           // b's check passes → skip
      else if (script === 'install-a') code = 0;    // a installs
      else if (script === 'install-c') code = 2;    // c fails
      else throw new Error(`unexpected script: ${script}`);
      void cmd;
      const emitter = new EventEmitter() as EventEmitter & { stdout: null; stderr: null };
      emitter.stdout = null;
      emitter.stderr = null;
      queueMicrotask(() => emitter.emit('close', code, null));
      return emitter;
    }) as unknown as typeof spawnFn;

    const plan = planBootstrap({
      catalog: [
        tool('a'),
        tool('b', { check: 'check-b' }),
        tool('c'),
        tool('d', { requires: ['c'] }),
      ],
      selectedIds: ['a', 'b', 'c', 'd'],
    });

    const result = await executeBootstrap({
      plan,
      vars: baseVars,
      runOptions: { spawnImpl: sequencedSpawn, log: () => {} },
      tuckDir: TEST_TUCK_DIR,
    });

    void callIdx;
    expect(result.counts).toEqual({ installed: 1, failed: 1, skipped: 2 });
  });
});
