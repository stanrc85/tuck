import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { spawn as spawnFn } from 'child_process';
import {
  runCheck,
  runInstall,
  runUpdate,
  scriptUsesSudo,
} from '../../src/lib/bootstrap/runner.js';
import type { ToolDefinition } from '../../src/schemas/bootstrap.schema.js';
import type { BootstrapVars } from '../../src/lib/bootstrap/interpolator.js';
import { BootstrapError } from '../../src/errors.js';

const vars: BootstrapVars = {
  VERSION: '1.2.3',
  ARCH: 'amd64',
  HOME: '/home/alice',
  OS: 'linux',
  TUCK_DIR: '/home/alice/.tuck',
};

const tool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id: 'pet',
  description: 'snippet manager',
  install: 'apt install -y pet',
  requires: [],
  detect: { paths: [], rcReferences: [] },
  ...overrides,
});

/**
 * Fake `spawn` that consumes one rule per call. Each rule matches on
 * command name + argv and resolves with the prescribed exit code after a
 * microtask. Tests pass the mock via `options.spawnImpl`, so no real
 * processes are launched.
 */
interface SpawnRule {
  match: (cmd: string, args: readonly string[]) => boolean;
  exitCode: number;
  signal?: NodeJS.Signals | null;
  /** Optional spy called when this rule fires. */
  onCall?: (cmd: string, args: readonly string[]) => void;
}

const makeSpawnMock = (rules: SpawnRule[]): { spawn: typeof spawnFn; calls: Array<{ cmd: string; args: readonly string[] }> } => {
  const calls: Array<{ cmd: string; args: readonly string[] }> = [];
  const impl = (cmd: string, args: readonly string[]) => {
    calls.push({ cmd, args });
    const rule = rules.find((r) => r.match(cmd, args));
    if (!rule) {
      throw new Error(
        `unexpected spawn call: ${cmd} ${args.join(' ')}. Matched rules: ${rules.length}`
      );
    }
    rule.onCall?.(cmd, args);
    const emitter = new EventEmitter() as EventEmitter & { stdout: null; stderr: null };
    emitter.stdout = null;
    emitter.stderr = null;
    queueMicrotask(() => {
      emitter.emit('close', rule.exitCode, rule.signal ?? null);
    });
    return emitter;
  };
  return { spawn: impl as unknown as typeof spawnFn, calls };
};

describe('scriptUsesSudo', () => {
  it('matches a leading sudo', () => {
    expect(scriptUsesSudo('sudo apt install pet')).toBe(true);
  });
  it('matches sudo after a semicolon or pipeline separator', () => {
    expect(scriptUsesSudo('cd /tmp; sudo apt install pet')).toBe(true);
    expect(scriptUsesSudo('true && sudo apt install pet')).toBe(true);
    expect(scriptUsesSudo('false || sudo apt install pet')).toBe(true);
  });
  it('matches sudo inside a multi-line script', () => {
    expect(
      scriptUsesSudo(`
curl -fsSL url -o /tmp/pet.deb
sudo dpkg -i /tmp/pet.deb
rm /tmp/pet.deb
`)
    ).toBe(true);
  });
  it('does not match substrings like sudoku', () => {
    expect(scriptUsesSudo('echo "play sudoku"')).toBe(false);
    expect(scriptUsesSudo('echo sudo_token')).toBe(false);
  });
  it('is false for a script with no sudo', () => {
    expect(scriptUsesSudo('brew install pet')).toBe(false);
  });
});

describe('runCheck', () => {
  it('returns false when the tool has no check field (no spawn)', async () => {
    const { spawn, calls } = makeSpawnMock([]);
    const result = await runCheck(tool(), vars, { spawnImpl: spawn });
    expect(result).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('returns true when the check script exits 0', async () => {
    const { spawn } = makeSpawnMock([
      { match: () => true, exitCode: 0 },
    ]);
    const result = await runCheck(
      tool({ check: 'command -v pet' }),
      vars,
      { spawnImpl: spawn }
    );
    expect(result).toBe(true);
  });

  it('returns false when the check script exits non-zero (no throw)', async () => {
    const { spawn } = makeSpawnMock([{ match: () => true, exitCode: 1 }]);
    const result = await runCheck(
      tool({ check: 'command -v pet' }),
      vars,
      { spawnImpl: spawn }
    );
    expect(result).toBe(false);
  });

  it('interpolates ${VERSION} in the check script before execution', async () => {
    const { spawn, calls } = makeSpawnMock([{ match: () => true, exitCode: 0 }]);
    await runCheck(
      tool({
        version: '1.2.3',
        check: "pet --version | grep -q '${VERSION}'",
      }),
      vars,
      { spawnImpl: spawn }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[1]).toBe("pet --version | grep -q '1.2.3'");
  });
});

describe('runInstall', () => {
  it('spawns bash -c with the interpolated install script', async () => {
    const { spawn, calls } = makeSpawnMock([{ match: () => true, exitCode: 0 }]);
    const result = await runInstall(
      tool({ install: 'curl .../v${VERSION}/pet.deb' }),
      vars,
      { spawnImpl: spawn, log: () => {} }
    );
    expect(result.ok).toBe(true);
    expect(calls[0]?.cmd).toBe('bash');
    expect(calls[0]?.args[0]).toBe('-c');
    expect(calls[0]?.args[1]).toContain('v1.2.3');
  });

  it('returns ok: false on non-zero exit without throwing', async () => {
    const { spawn } = makeSpawnMock([{ match: () => true, exitCode: 17 }]);
    const result = await runInstall(tool(), vars, { spawnImpl: spawn, log: () => {} });
    expect(result).toEqual({ ok: false, exitCode: 17, signal: null });
  });

  it('dry-run prints without spawning', async () => {
    const { spawn, calls } = makeSpawnMock([]);
    const log = vi.fn();
    const result = await runInstall(tool(), vars, {
      spawnImpl: spawn,
      dryRun: true,
      log,
    });
    expect(result).toEqual({ ok: true, exitCode: 0, signal: null });
    expect(calls).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[dry-run\] pet install:/));
  });

  it('propagates interpolator errors for undeclared ${VERSION}', async () => {
    const { spawn } = makeSpawnMock([]);
    const { VERSION: _unused, ...bare } = vars;
    void _unused;
    await expect(
      runInstall(tool({ install: 'download v${VERSION}' }), bare as BootstrapVars, {
        spawnImpl: spawn,
        log: () => {},
      })
    ).rejects.toBeInstanceOf(BootstrapError);
  });
});

describe('runUpdate', () => {
  it('falls back to install when update is omitted', async () => {
    const { spawn, calls } = makeSpawnMock([{ match: () => true, exitCode: 0 }]);
    await runUpdate(
      tool({ install: 'apt install -y pet' }),
      vars,
      { spawnImpl: spawn, log: () => {} }
    );
    expect(calls[0]?.args[1]).toBe('apt install -y pet');
  });

  it('falls back to install when update is "@install"', async () => {
    const { spawn, calls } = makeSpawnMock([{ match: () => true, exitCode: 0 }]);
    await runUpdate(
      tool({ install: 'apt install -y pet', update: '@install' }),
      vars,
      { spawnImpl: spawn, log: () => {} }
    );
    expect(calls[0]?.args[1]).toBe('apt install -y pet');
  });

  it('uses the update script when explicitly provided', async () => {
    const { spawn, calls } = makeSpawnMock([{ match: () => true, exitCode: 0 }]);
    await runUpdate(
      tool({ install: 'apt install pet', update: 'apt upgrade -y pet' }),
      vars,
      { spawnImpl: spawn, log: () => {} }
    );
    expect(calls[0]?.args[1]).toBe('apt upgrade -y pet');
  });
});

describe('autoYes sudo pre-check', () => {
  it('pre-checks `sudo -n true` when script contains sudo under --yes', async () => {
    const { spawn, calls } = makeSpawnMock([
      {
        match: (cmd, args) => cmd === 'sudo' && args[0] === '-n',
        exitCode: 0,
      },
      { match: (cmd) => cmd === 'bash', exitCode: 0 },
    ]);
    await runInstall(
      tool({ install: 'sudo apt install -y pet' }),
      vars,
      { spawnImpl: spawn, autoYes: true, log: () => {} }
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]?.cmd).toBe('sudo');
    expect(calls[0]?.args).toEqual(['-n', 'true']);
    expect(calls[1]?.cmd).toBe('bash');
  });

  it('throws BootstrapError when sudo -n returns non-zero', async () => {
    const { spawn, calls } = makeSpawnMock([
      {
        match: (cmd) => cmd === 'sudo',
        exitCode: 1,
      },
    ]);
    await expect(
      runInstall(tool({ install: 'sudo apt install pet' }), vars, {
        spawnImpl: spawn,
        autoYes: true,
        log: () => {},
      })
    ).rejects.toBeInstanceOf(BootstrapError);
    // Should short-circuit — no bash spawn after sudo fails.
    expect(calls).toHaveLength(1);
  });

  it('skips the pre-check when script has no sudo', async () => {
    const { spawn, calls } = makeSpawnMock([
      { match: (cmd) => cmd === 'bash', exitCode: 0 },
    ]);
    await runInstall(
      tool({ install: 'brew install pet' }),
      vars,
      { spawnImpl: spawn, autoYes: true, log: () => {} }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('bash');
  });

  it('skips the pre-check when autoYes is false (interactive mode)', async () => {
    // Interactive users type their password when sudo prompts — no pre-check needed.
    const { spawn, calls } = makeSpawnMock([
      { match: (cmd) => cmd === 'bash', exitCode: 0 },
    ]);
    await runInstall(
      tool({ install: 'sudo apt install pet' }),
      vars,
      { spawnImpl: spawn, autoYes: false, log: () => {} }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('bash');
  });
});
