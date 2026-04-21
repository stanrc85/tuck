import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const confirmMock = vi.fn();
const logSuccessMock = vi.fn();
const logWarningMock = vi.fn();
const isInteractiveMock = vi.fn(() => true);

vi.mock('../../src/ui/index.js', () => ({
  prompts: {
    confirm: confirmMock,
    intro: vi.fn(),
    outro: vi.fn(),
    multiselect: vi.fn(),
    select: vi.fn(),
    cancel: vi.fn(),
    note: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: '' })),
    log: {
      info: vi.fn(),
      success: logSuccessMock,
      warning: logWarningMock,
      error: vi.fn(),
      message: vi.fn(),
    },
  },
  isInteractive: isInteractiveMock,
}));

interface FakeChild extends EventEmitter {
  stdout?: EventEmitter;
}

interface SpawnScript {
  which?: { exitCode: number; stdout?: string };
  chsh?: { exitCode: number };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeFakeSpawn = (script: SpawnScript): any => {
  const fn = (cmd: string): FakeChild => {
    const child = new EventEmitter() as FakeChild;
    if (cmd === 'which') {
      const stdoutEmitter = new EventEmitter();
      child.stdout = stdoutEmitter;
      const spec = script.which;
      setImmediate(() => {
        if (spec) {
          if (spec.stdout) stdoutEmitter.emit('data', Buffer.from(spec.stdout));
          child.emit('exit', spec.exitCode);
        } else {
          child.emit('error', new Error('no which script configured'));
        }
      });
    } else if (cmd === 'chsh') {
      setImmediate(() => {
        if (script.chsh) {
          child.emit('exit', script.chsh.exitCode);
        } else {
          child.emit('error', new Error('no chsh script configured'));
        }
      });
    } else {
      setImmediate(() => child.emit('error', new Error(`unexpected cmd ${cmd}`)));
    }
    return child;
  };
  return fn;
};

describe('maybePromptForShellChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isInteractiveMock.mockReturnValue(true);
  });

  it('no-ops on Windows', async () => {
    const { maybePromptForShellChange } = await import('../../src/commands/bootstrap.js');
    await maybePromptForShellChange({ platform: 'win32' });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('no-ops when not interactive (non-TTY / CI)', async () => {
    const { maybePromptForShellChange } = await import('../../src/commands/bootstrap.js');
    await maybePromptForShellChange({ platform: 'linux', interactive: false });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('no-ops when login shell is already zsh', async () => {
    const { maybePromptForShellChange } = await import('../../src/commands/bootstrap.js');
    await maybePromptForShellChange({ platform: 'linux', envShell: '/bin/zsh' });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('no-ops when zsh is not installed (which exits non-zero)', async () => {
    const { maybePromptForShellChange } = await import('../../src/commands/bootstrap.js');
    await maybePromptForShellChange({
      platform: 'linux',
      envShell: '/bin/bash',
      spawnImpl: makeFakeSpawn({ which: { exitCode: 1 } }),
    });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('prompts and runs chsh when user confirms', async () => {
    confirmMock.mockResolvedValueOnce(true);
    const { maybePromptForShellChange } = await import('../../src/commands/bootstrap.js');
    await maybePromptForShellChange({
      platform: 'linux',
      envShell: '/bin/bash',
      spawnImpl: makeFakeSpawn({
        which: { exitCode: 0, stdout: '/usr/bin/zsh\n' },
        chsh: { exitCode: 0 },
      }),
    });
    expect(confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('bash'),
      true
    );
    expect(logSuccessMock).toHaveBeenCalledWith(
      expect.stringContaining('Default shell changed to zsh')
    );
  });

  it('does not run chsh when user declines', async () => {
    confirmMock.mockResolvedValueOnce(false);
    let chshInvoked = false;
    const spawnImpl = (cmd: string): FakeChild => {
      const child = new EventEmitter() as FakeChild;
      if (cmd === 'which') {
        const stdoutEmitter = new EventEmitter();
        child.stdout = stdoutEmitter;
        setImmediate(() => {
          stdoutEmitter.emit('data', Buffer.from('/usr/bin/zsh\n'));
          child.emit('exit', 0);
        });
      } else if (cmd === 'chsh') {
        chshInvoked = true;
        setImmediate(() => child.emit('exit', 0));
      }
      return child;
    };
    const { maybePromptForShellChange } = await import('../../src/commands/bootstrap.js');
    await maybePromptForShellChange({
      platform: 'linux',
      envShell: '/bin/bash',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spawnImpl: spawnImpl as any,
    });
    expect(chshInvoked).toBe(false);
    expect(logSuccessMock).not.toHaveBeenCalled();
  });

  it('warns with manual fallback when chsh fails', async () => {
    confirmMock.mockResolvedValueOnce(true);
    const { maybePromptForShellChange } = await import('../../src/commands/bootstrap.js');
    await maybePromptForShellChange({
      platform: 'linux',
      envShell: '/bin/bash',
      spawnImpl: makeFakeSpawn({
        which: { exitCode: 0, stdout: '/usr/bin/zsh\n' },
        chsh: { exitCode: 1 },
      }),
    });
    expect(logWarningMock).toHaveBeenCalledWith(
      expect.stringContaining('chsh -s /usr/bin/zsh')
    );
    expect(logSuccessMock).not.toHaveBeenCalled();
  });

  it('fires on macOS too (not only Linux)', async () => {
    confirmMock.mockResolvedValueOnce(true);
    const { maybePromptForShellChange } = await import('../../src/commands/bootstrap.js');
    await maybePromptForShellChange({
      platform: 'darwin',
      envShell: '/bin/bash',
      spawnImpl: makeFakeSpawn({
        which: { exitCode: 0, stdout: '/usr/local/bin/zsh\n' },
        chsh: { exitCode: 0 },
      }),
    });
    expect(confirmMock).toHaveBeenCalled();
  });
});
