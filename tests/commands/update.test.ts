import { describe, it, expect, beforeEach, vi } from 'vitest';
import { vol } from 'memfs';
import { EventEmitter } from 'events';
import { join } from 'path';
import type { spawn as spawnFn } from 'child_process';
import { runUpdate } from '../../src/commands/update.js';
import { TEST_TUCK_DIR } from '../setup.js';

/**
 * `tuck update` tests. Isolate phases by mocking: runSelfUpdate,
 * runRestore, runBootstrapUpdate, and the lib/git primitives. Keeps this
 * suite at the command layer — phase-internal behavior is already covered
 * by self-update.test.ts, restore.test.ts, bootstrap-update.test.ts.
 */

// We import the modules we're mocking before we define the mocks so
// vi.mock hoisting picks them up. Matches the pattern in sync.test.ts.

vi.mock('../../src/commands/self-update.js', () => ({
  runSelfUpdate: vi.fn(async () => ({ updated: false })),
}));

vi.mock('../../src/commands/restore.js', () => ({
  runRestore: vi.fn(async () => undefined),
}));

vi.mock('../../src/commands/bootstrap-update.js', () => ({
  runBootstrapUpdate: vi.fn(async () => ({
    plan: null,
    counts: { updated: 0, failed: 0, skipped: 0 },
    dryRun: false,
  })),
}));

vi.mock('../../src/lib/git.js', () => ({
  fetch: vi.fn(async () => undefined),
  pull: vi.fn(async () => undefined),
  getHeadSha: vi.fn(async () => 'sha-default'),
  hasRemote: vi.fn(async () => true),
  isGitRepo: vi.fn(async () => true),
  getAheadBehind: vi.fn(async () => ({ ahead: 0, behind: 0 })),
  resetHard: vi.fn(async () => undefined),
}));

vi.mock('../../src/lib/manifest.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/manifest.js')>();
  return {
    ...original,
    loadManifest: vi.fn(async () => ({
      version: '2.0.0',
      files: {},
    })),
    assertMigrated: vi.fn(),
  };
});

// `withSpinner` wraps the inner fn through @clack/prompts; under vitest
// it tends to leave the spinner open. Replace it with a pass-through.
vi.mock('../../src/ui/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/ui/index.js')>();
  return {
    ...original,
    withSpinner: vi.fn(async (_msg: string, fn: () => Promise<unknown>) => fn()),
  };
});

describe('runUpdate', () => {
  beforeEach(() => {
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
    vi.clearAllMocks();
    delete process.env.TUCK_UPDATE_RESUMED;
  });

  describe('phase ordering', () => {
    it('runs all four phases in order when no --no-* flags are set', async () => {
      const { runSelfUpdate } = await import('../../src/commands/self-update.js');
      const { runRestore } = await import('../../src/commands/restore.js');
      const { runBootstrapUpdate } = await import('../../src/commands/bootstrap-update.js');
      const { fetch, pull, getHeadSha } = await import('../../src/lib/git.js');

      // Simulate a pull that changes HEAD → restore should run.
      (getHeadSha as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('sha-before')
        .mockResolvedValueOnce('sha-after');

      const result = await runUpdate({});

      expect(runSelfUpdate).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(pull).toHaveBeenCalledTimes(1);
      expect(runRestore).toHaveBeenCalledTimes(1);
      expect(runBootstrapUpdate).toHaveBeenCalledTimes(1);
      expect(result.selfUpdated).toBe(false);
      expect(result.dotfilesChanged).toBe(true);
      expect(result.restoreRan).toBe(true);
      expect(result.toolsRan).toBe(true);
      expect(result.reExeced).toBe(false);
    });

    it('skips restore when pull produced no new commits', async () => {
      const { runRestore } = await import('../../src/commands/restore.js');
      const { getHeadSha } = await import('../../src/lib/git.js');
      (getHeadSha as ReturnType<typeof vi.fn>).mockResolvedValue('sha-same');

      const result = await runUpdate({});
      expect(result.dotfilesChanged).toBe(false);
      expect(result.restoreRan).toBe(false);
      expect(runRestore).not.toHaveBeenCalled();
    });

    it('skips pull when --no-pull and never runs restore', async () => {
      const { fetch, pull } = await import('../../src/lib/git.js');
      const { runRestore } = await import('../../src/commands/restore.js');
      const result = await runUpdate({ pull: false });
      expect(fetch).not.toHaveBeenCalled();
      expect(pull).not.toHaveBeenCalled();
      expect(runRestore).not.toHaveBeenCalled();
      expect(result.dotfilesChanged).toBe(false);
    });

    it('skips restore when --no-restore even if dotfiles changed', async () => {
      const { runRestore } = await import('../../src/commands/restore.js');
      const { getHeadSha } = await import('../../src/lib/git.js');
      (getHeadSha as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('sha-before')
        .mockResolvedValueOnce('sha-after');

      const result = await runUpdate({ restore: false });
      expect(result.dotfilesChanged).toBe(true);
      expect(result.restoreRan).toBe(false);
      expect(runRestore).not.toHaveBeenCalled();
    });

    it('skips bootstrap update phase when --no-tools', async () => {
      const { runBootstrapUpdate } = await import('../../src/commands/bootstrap-update.js');
      const result = await runUpdate({ tools: false });
      expect(runBootstrapUpdate).not.toHaveBeenCalled();
      expect(result.toolsRan).toBe(false);
    });

    it('skips self-update when --no-self', async () => {
      const { runSelfUpdate } = await import('../../src/commands/self-update.js');
      const result = await runUpdate({ self: false });
      expect(runSelfUpdate).not.toHaveBeenCalled();
      expect(result.selfUpdated).toBe(false);
    });

    it('skips self-update when TUCK_UPDATE_RESUMED=1 even without --no-self', async () => {
      const { runSelfUpdate } = await import('../../src/commands/self-update.js');
      const result = await runUpdate({ resumed: true });
      expect(runSelfUpdate).not.toHaveBeenCalled();
      expect(result.selfUpdated).toBe(false);
    });
  });

  describe('self-update re-exec', () => {
    it('re-execs tuck with --no-self when self-update applied', async () => {
      const { runSelfUpdate } = await import('../../src/commands/self-update.js');
      (runSelfUpdate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        updated: true,
        targetVersion: '9.9.9',
      });

      const spawnCalls: Array<{ cmd: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
      const fakeSpawn = ((cmd: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv }) => {
        spawnCalls.push({ cmd, args, env: opts.env });
        const emitter = new EventEmitter() as EventEmitter & { stdout: null; stderr: null };
        emitter.stdout = null;
        emitter.stderr = null;
        queueMicrotask(() => emitter.emit('close', 0, null));
        return emitter;
      }) as unknown as typeof spawnFn;

      const result = await runUpdate({ spawnImpl: fakeSpawn });

      expect(result.reExeced).toBe(true);
      expect(result.reExecExitCode).toBe(0);
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]?.cmd).toBe('tuck');
      expect(spawnCalls[0]?.args).toContain('update');
      expect(spawnCalls[0]?.args).toContain('--no-self');
      expect(spawnCalls[0]?.env.TUCK_UPDATE_RESUMED).toBe('1');
    });

    it('does NOT re-exec when self-update ran but applied no update', async () => {
      const { runSelfUpdate } = await import('../../src/commands/self-update.js');
      (runSelfUpdate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        updated: false,
        targetVersion: '2.1.1',
      });
      const spawnCalls: Array<unknown> = [];
      const fakeSpawn = (() => {
        spawnCalls.push({});
        throw new Error('should not spawn');
      }) as unknown as typeof spawnFn;

      const result = await runUpdate({ spawnImpl: fakeSpawn });
      expect(result.reExeced).toBe(false);
      expect(spawnCalls).toHaveLength(0);
    });

    it('forwards --no-pull / --no-restore / --no-tools / --yes to the re-execed child', async () => {
      const { runSelfUpdate } = await import('../../src/commands/self-update.js');
      (runSelfUpdate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ updated: true });

      const spawnCalls: Array<{ args: readonly string[] }> = [];
      const fakeSpawn = ((_cmd: string, args: readonly string[]) => {
        spawnCalls.push({ args });
        const emitter = new EventEmitter() as EventEmitter & { stdout: null; stderr: null };
        emitter.stdout = null;
        emitter.stderr = null;
        queueMicrotask(() => emitter.emit('close', 0, null));
        return emitter;
      }) as unknown as typeof spawnFn;

      await runUpdate({
        pull: false,
        restore: false,
        tools: false,
        yes: true,
        spawnImpl: fakeSpawn,
      });

      const args = spawnCalls[0]?.args ?? [];
      expect(args).toContain('--no-self');
      expect(args).toContain('--no-pull');
      expect(args).toContain('--no-restore');
      expect(args).toContain('--no-tools');
      expect(args).toContain('--yes');
    });
  });

  describe('resilience', () => {
    it('continues with remaining phases when self-update throws', async () => {
      const { runSelfUpdate } = await import('../../src/commands/self-update.js');
      const { runBootstrapUpdate } = await import('../../src/commands/bootstrap-update.js');
      (runSelfUpdate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('network unreachable')
      );
      const result = await runUpdate({});
      expect(result.selfUpdated).toBe(false);
      expect(result.reExeced).toBe(false);
      // Bootstrap phase should still have run — the umbrella can't
      // strand the user on a half-refreshed system just because github
      // was flaky.
      expect(runBootstrapUpdate).toHaveBeenCalled();
    });

    it('no-ops the pull phase when no remote is configured', async () => {
      const { fetch, pull, hasRemote } = await import('../../src/lib/git.js');
      (hasRemote as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
      const result = await runUpdate({ self: false });
      expect(fetch).not.toHaveBeenCalled();
      expect(pull).not.toHaveBeenCalled();
      expect(result.dotfilesChanged).toBe(false);
    });

    it('swallows pull GitError and keeps going with subsequent phases', async () => {
      const { pull } = await import('../../src/lib/git.js');
      const { runBootstrapUpdate } = await import('../../src/commands/bootstrap-update.js');
      const { GitError } = await import('../../src/errors.js');
      (pull as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new GitError('pull failed', 'test')
      );

      const result = await runUpdate({ self: false });
      expect(result.dotfilesChanged).toBe(false);
      expect(runBootstrapUpdate).toHaveBeenCalled();
    });
  });

  describe('divergence gate (TASK-043)', () => {
    it('throws DivergenceError when ahead>0 and behind>0 without --allow-divergent', async () => {
      const { getAheadBehind } = await import('../../src/lib/git.js');
      (getAheadBehind as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ahead: 2, behind: 3 });

      await expect(runUpdate({ self: false, tools: false })).rejects.toMatchObject({
        code: 'DIVERGENCE_DETECTED',
      });
    });

    it('bypasses the gate when --allow-divergent is set', async () => {
      const { getAheadBehind, pull } = await import('../../src/lib/git.js');
      (getAheadBehind as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ahead: 2, behind: 3 });

      await runUpdate({ self: false, tools: false, allowDivergent: true });
      expect(pull).toHaveBeenCalledTimes(1);
    });

    it('does NOT throw when only ahead (rebase-mode is still safe)', async () => {
      const { getAheadBehind, pull } = await import('../../src/lib/git.js');
      (getAheadBehind as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ahead: 4, behind: 0 });

      await runUpdate({ self: false, tools: false });
      expect(pull).toHaveBeenCalledTimes(1);
    });

    it('does NOT throw when only behind (fast-forward)', async () => {
      const { getAheadBehind, pull } = await import('../../src/lib/git.js');
      (getAheadBehind as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ahead: 0, behind: 5 });

      await runUpdate({ self: false, tools: false });
      expect(pull).toHaveBeenCalledTimes(1);
    });
  });

  describe('mirror mode (TASK-044)', () => {
    it('calls resetHard(@{u}) instead of pull when --mirror is set', async () => {
      const { resetHard, pull } = await import('../../src/lib/git.js');
      await runUpdate({ self: false, tools: false, mirror: true });
      expect(resetHard).toHaveBeenCalledWith('/test-home/.tuck', '@{u}');
      expect(pull).not.toHaveBeenCalled();
    });

    it('refuses --mirror when ahead>0 without --allow-divergent', async () => {
      const { getAheadBehind, resetHard } = await import('../../src/lib/git.js');
      (getAheadBehind as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ahead: 1, behind: 0 });

      await expect(
        runUpdate({ self: false, tools: false, mirror: true })
      ).rejects.toMatchObject({ code: 'DIVERGENCE_DETECTED' });
      expect(resetHard).not.toHaveBeenCalled();
    });

    it('allows --mirror with --allow-divergent even when ahead>0', async () => {
      const { getAheadBehind, resetHard } = await import('../../src/lib/git.js');
      (getAheadBehind as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ahead: 1, behind: 0 });

      await runUpdate({ self: false, tools: false, mirror: true, allowDivergent: true });
      expect(resetHard).toHaveBeenCalledTimes(1);
    });

    it('forwards --mirror and --allow-divergent to re-execed child', async () => {
      const { runSelfUpdate } = await import('../../src/commands/self-update.js');
      (runSelfUpdate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ updated: true });

      const spawnCalls: Array<{ args: readonly string[] }> = [];
      const fakeSpawn = ((_cmd: string, args: readonly string[]) => {
        spawnCalls.push({ args });
        const emitter = new EventEmitter() as EventEmitter & { stdout: null; stderr: null };
        emitter.stdout = null;
        emitter.stderr = null;
        queueMicrotask(() => emitter.emit('close', 0, null));
        return emitter;
      }) as unknown as typeof spawnFn;

      await runUpdate({
        mirror: true,
        allowDivergent: true,
        spawnImpl: fakeSpawn,
      });

      const args = spawnCalls[0]?.args ?? [];
      expect(args).toContain('--mirror');
      expect(args).toContain('--allow-divergent');
    });
  });

  it('guards join path (cli-smoke target)', async () => {
    // Cheap sanity: the tuck test dir must exist before we invoke, else
    // loadManifest fails early. Written once to guard setup regressions.
    expect(vol.existsSync(join(TEST_TUCK_DIR))).toBe(true);
  });
});
