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
import type { OutputContext } from '../../src/lib/output.js';
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

/**
 * Spawn mock for the pipe-tee path. Each rule names what it'll write on
 * stdout/stderr (split into chunks to mimic streaming) and what exit code
 * to deliver. The fake child exposes Readable streams so the runner's
 * `child.stdout?.on('data', ...)` listener fires as it would for a real
 * subprocess.
 */
interface StreamSpawnRule {
  match: (cmd: string, args: readonly string[]) => boolean;
  stdoutChunks?: string[];
  stderrChunks?: string[];
  exitCode: number;
  signal?: NodeJS.Signals | null;
}

const makeStreamSpawnMock = (
  rules: StreamSpawnRule[]
): { spawn: typeof spawnFn; calls: Array<{ cmd: string; stdio: unknown }> } => {
  const calls: Array<{ cmd: string; stdio: unknown }> = [];
  const impl = (cmd: string, args: readonly string[], opts?: { stdio?: unknown }) => {
    calls.push({ cmd, stdio: opts?.stdio });
    const rule = rules.find((r) => r.match(cmd, args));
    if (!rule) {
      throw new Error(`unexpected spawn call: ${cmd} ${args.join(' ')}`);
    }
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    queueMicrotask(() => {
      // Listeners are attached synchronously in the runner before any
      // microtask runs, so emitting 'data' here reliably reaches them.
      for (const chunk of rule.stdoutChunks ?? []) {
        stdout.emit('data', Buffer.from(chunk));
      }
      for (const chunk of rule.stderrChunks ?? []) {
        stderr.emit('data', Buffer.from(chunk));
      }
      child.emit('close', rule.exitCode, rule.signal ?? null);
    });
    return child;
  };
  return { spawn: impl as unknown as typeof spawnFn, calls };
};

const makeFakeOutputCtx = (verbose: boolean): {
  ctx: OutputContext;
  logged: string[];
  closed: () => boolean;
} => {
  const logged: string[] = [];
  let closed = false;
  return {
    logged,
    closed: () => closed,
    ctx: {
      verbose,
      logPath: '/test-home/.tuck/logs/fake.log',
      // The runner only ever calls `outputCtx.log` — the underlying file
      // stream isn't touched directly. A no-op WriteStream-shaped stub is
      // enough for unit tests.
      logFile: { write: () => true } as unknown as OutputContext['logFile'],
      log: (label, line) => {
        logged.push(`[${label}] ${line.replace(/\r?\n$/, '')}`);
      },
      close: async () => {
        closed = true;
      },
    },
  };
};

describe('outputCtx pipe-and-tee', () => {
  it('uses piped stdio when outputCtx is supplied', async () => {
    const { spawn, calls } = makeStreamSpawnMock([
      { match: (cmd) => cmd === 'bash', exitCode: 0 },
    ]);
    const { ctx } = makeFakeOutputCtx(false);
    await runInstall(tool(), vars, { spawnImpl: spawn, log: () => {}, outputCtx: ctx });
    expect(calls[0]?.stdio).toEqual(['inherit', 'pipe', 'pipe']);
  });

  it('falls back to inherit stdio when outputCtx is omitted', async () => {
    const { spawn, calls } = makeStreamSpawnMock([
      { match: (cmd) => cmd === 'bash', exitCode: 0 },
    ]);
    await runInstall(tool(), vars, { spawnImpl: spawn, log: () => {} });
    expect(calls[0]?.stdio).toBe('inherit');
  });

  it('writes both stdout and stderr to the log', async () => {
    const { spawn } = makeStreamSpawnMock([
      {
        match: (cmd) => cmd === 'bash',
        exitCode: 0,
        stdoutChunks: ['Reading package lists...\n'],
        stderrChunks: ['W: warning text\n'],
      },
    ]);
    const { ctx, logged } = makeFakeOutputCtx(false);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await runInstall(tool(), vars, { spawnImpl: spawn, log: () => {}, outputCtx: ctx });
      expect(logged.some((l) => l.includes('Reading package lists'))).toBe(true);
      expect(logged.some((l) => l.includes('W: warning text'))).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('forwards stdout to terminal only in verbose mode', async () => {
    const { spawn } = makeStreamSpawnMock([
      {
        match: (cmd) => cmd === 'bash',
        exitCode: 0,
        stdoutChunks: ['stdout line\n'],
      },
    ]);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const { ctx } = makeFakeOutputCtx(false);
      await runInstall(tool(), vars, { spawnImpl: spawn, log: () => {}, outputCtx: ctx });
      const stdoutCalls = stdoutSpy.mock.calls.filter((args) =>
        String(args[0]).includes('stdout line')
      );
      expect(stdoutCalls).toHaveLength(0);
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('forwards stdout to terminal in verbose mode', async () => {
    const { spawn } = makeStreamSpawnMock([
      {
        match: (cmd) => cmd === 'bash',
        exitCode: 0,
        stdoutChunks: ['verbose stdout line\n'],
      },
    ]);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const { ctx } = makeFakeOutputCtx(true);
      await runInstall(tool(), vars, { spawnImpl: spawn, log: () => {}, outputCtx: ctx });
      const stdoutCalls = stdoutSpy.mock.calls.filter((args) =>
        String(args[0]).includes('verbose stdout line')
      );
      expect(stdoutCalls.length).toBeGreaterThan(0);
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('always forwards stderr to terminal so prompts and errors are visible', async () => {
    const { spawn } = makeStreamSpawnMock([
      {
        match: (cmd) => cmd === 'bash',
        exitCode: 0,
        stderrChunks: ['error or warning text\n'],
      },
    ]);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { ctx } = makeFakeOutputCtx(false);
      await runInstall(tool(), vars, { spawnImpl: spawn, log: () => {}, outputCtx: ctx });
      const stderrCalls = stderrSpy.mock.calls.filter((args) =>
        String(args[0]).includes('error or warning text')
      );
      expect(stderrCalls.length).toBeGreaterThan(0);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('fires onInteractivePrompt the first time a sudo prompt appears in non-verbose mode', async () => {
    const { spawn } = makeStreamSpawnMock([
      {
        match: (cmd) => cmd === 'bash',
        exitCode: 0,
        stderrChunks: ['[sudo] password for alice: '],
      },
    ]);
    const onPrompt = vi.fn();
    const { ctx } = makeFakeOutputCtx(false);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await runInstall(tool(), vars, {
        spawnImpl: spawn,
        log: () => {},
        outputCtx: ctx,
        onInteractivePrompt: onPrompt,
      });
      expect(onPrompt).toHaveBeenCalledTimes(1);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('does not fire onInteractivePrompt in verbose mode', async () => {
    const { spawn } = makeStreamSpawnMock([
      {
        match: (cmd) => cmd === 'bash',
        exitCode: 0,
        stderrChunks: ['[sudo] password for alice: '],
      },
    ]);
    const onPrompt = vi.fn();
    const { ctx } = makeFakeOutputCtx(true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await runInstall(tool(), vars, {
        spawnImpl: spawn,
        log: () => {},
        outputCtx: ctx,
        onInteractivePrompt: onPrompt,
      });
      expect(onPrompt).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('drops brew "already installed" warnings from terminal stderr in default mode', async () => {
    const { spawn } = makeStreamSpawnMock([
      {
        match: (cmd) => cmd === 'bash',
        exitCode: 0,
        stderrChunks: [
          'Warning: fzf 0.72.0 already installed\n',
          'Warning: bat 0.26.1 already installed\n',
        ],
      },
    ]);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { ctx, logged } = makeFakeOutputCtx(false);
      await runInstall(tool(), vars, { spawnImpl: spawn, log: () => {}, outputCtx: ctx });
      const calls = stderrSpy.mock.calls.map((args) => String(args[0]));
      expect(calls.some((s) => s.includes('already installed'))).toBe(false);
      // ...but the log file still records them so users can audit if needed.
      expect(logged.some((l) => l.includes('fzf 0.72.0 already installed'))).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('keeps "already installed" warnings on terminal in verbose mode', async () => {
    const { spawn } = makeStreamSpawnMock([
      {
        match: (cmd) => cmd === 'bash',
        exitCode: 0,
        stderrChunks: ['Warning: fzf 0.72.0 already installed\n'],
      },
    ]);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { ctx } = makeFakeOutputCtx(true);
      await runInstall(tool(), vars, { spawnImpl: spawn, log: () => {}, outputCtx: ctx });
      const calls = stderrSpy.mock.calls.map((args) => String(args[0]));
      expect(calls.some((s) => s.includes('already installed'))).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('still forwards real warnings interleaved with noise lines', async () => {
    const { spawn } = makeStreamSpawnMock([
      {
        match: (cmd) => cmd === 'bash',
        exitCode: 0,
        stderrChunks: [
          'Warning: fzf 0.72.0 already installed\nError: tap not found\nWarning: bat 0.26.1 already installed\n',
        ],
      },
    ]);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { ctx } = makeFakeOutputCtx(false);
      await runInstall(tool(), vars, { spawnImpl: spawn, log: () => {}, outputCtx: ctx });
      const joined = stderrSpy.mock.calls.map((args) => String(args[0])).join('');
      expect(joined).toContain('Error: tap not found');
      expect(joined).not.toContain('already installed');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('forwards a partial-line sudo prompt even when noise lines arrived first', async () => {
    const { spawn } = makeStreamSpawnMock([
      {
        match: (cmd) => cmd === 'bash',
        exitCode: 0,
        stderrChunks: [
          'Warning: fzf 0.72.0 already installed\n',
          '[sudo] password for alice: ',
        ],
      },
    ]);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { ctx } = makeFakeOutputCtx(false);
      await runInstall(tool(), vars, { spawnImpl: spawn, log: () => {}, outputCtx: ctx });
      const joined = stderrSpy.mock.calls.map((args) => String(args[0])).join('');
      expect(joined).toContain('[sudo] password');
      expect(joined).not.toContain('already installed');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('reassembles a noise line that arrives in two chunks', async () => {
    const { spawn } = makeStreamSpawnMock([
      {
        match: (cmd) => cmd === 'bash',
        exitCode: 0,
        stderrChunks: ['Warning: fzf 0.72.0 already inst', 'alled\n'],
      },
    ]);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const { ctx } = makeFakeOutputCtx(false);
      await runInstall(tool(), vars, { spawnImpl: spawn, log: () => {}, outputCtx: ctx });
      const joined = stderrSpy.mock.calls.map((args) => String(args[0])).join('');
      expect(joined).not.toContain('already installed');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('returns a non-zero exit code through the tee path', async () => {
    const { spawn } = makeStreamSpawnMock([
      {
        match: (cmd) => cmd === 'bash',
        exitCode: 17,
        stderrChunks: ['boom\n'],
      },
    ]);
    const { ctx } = makeFakeOutputCtx(false);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const result = await runInstall(tool(), vars, {
        spawnImpl: spawn,
        log: () => {},
        outputCtx: ctx,
      });
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(17);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
