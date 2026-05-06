import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import {
  checkClockSkew,
  checkAptLock,
  checkDiskSpace,
  checkNetworkReachable,
  checkSudoReachable,
  planNeedsSudo,
  runPreflightChecks,
} from '../../src/lib/bootstrap/preflight.js';
import type { ToolDefinition } from '../../src/schemas/bootstrap.schema.js';

const tool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id: 'sample',
  description: 'sample',
  category: 'shell',
  install: 'echo hi',
  requires: [],
  detect: { paths: [], rcReferences: [] },
  ...overrides,
});

const fakeResponse = (headers: Record<string, string>, status = 200): Response => {
  return {
    status,
    ok: status < 400,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as unknown as Response;
};

const fakeProc = (exitCode: number, errorOnSpawn = false) => {
  return () => {
    const ee = new EventEmitter();
    setImmediate(() => {
      if (errorOnSpawn) {
        ee.emit('error', new Error('ENOENT'));
      } else {
        ee.emit('close', exitCode);
      }
    });
    // The runner only listens to 'error' and 'close', so EventEmitter is enough.
    return ee as unknown as ReturnType<typeof import('child_process').spawn>;
  };
};

describe('checkClockSkew', () => {
  it('passes when remote and local clocks agree', async () => {
    const fetchImpl = (async () =>
      fakeResponse({ date: new Date().toUTCString() })) as unknown as typeof fetch;
    const result = await checkClockSkew({ fetchImpl });
    expect(result.status).toBe('pass');
  });

  it('warns when local clock is more than 30 minutes behind', async () => {
    const remoteDate = new Date(Date.now() + 60 * 60 * 1000);
    const fetchImpl = (async () =>
      fakeResponse({ date: remoteDate.toUTCString() })) as unknown as typeof fetch;
    const result = await checkClockSkew({ fetchImpl });
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/min off/);
    expect(result.remediation).toMatch(/timedatectl/);
  });

  it('skips when remote response has no Date header', async () => {
    const fetchImpl = (async () => fakeResponse({})) as unknown as typeof fetch;
    const result = await checkClockSkew({ fetchImpl });
    expect(result.status).toBe('skip');
  });

  it('skips when fetch throws', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const result = await checkClockSkew({ fetchImpl });
    expect(result.status).toBe('skip');
  });
});

describe('checkAptLock', () => {
  it('skips on non-linux platforms', async () => {
    const result = await checkAptLock({ platform: 'darwin' });
    expect(result.status).toBe('skip');
  });

  it('passes on linux when fuser exits non-zero (no holder)', async () => {
    const result = await checkAptLock({
      platform: 'linux',
      spawnImpl: fakeProc(1) as unknown as typeof import('child_process').spawn,
    });
    expect(result.status).toBe('pass');
  });

  it('warns on linux when fuser exits 0 (lock held)', async () => {
    const result = await checkAptLock({
      platform: 'linux',
      spawnImpl: fakeProc(0) as unknown as typeof import('child_process').spawn,
    });
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/lock-frontend/);
  });

  it('skips on linux when fuser is not installed', async () => {
    const result = await checkAptLock({
      platform: 'linux',
      spawnImpl: fakeProc(0, true) as unknown as typeof import('child_process').spawn,
    });
    expect(result.status).toBe('skip');
  });
});

describe('checkDiskSpace', () => {
  it('passes when free bytes exceed the threshold', async () => {
    const statfsImpl = (async () => ({
      bavail: 10_000,
      bsize: 1024 * 1024 * 1024,
    })) as unknown as typeof import('fs/promises').statfs;
    const result = await checkDiskSpace({ statfsImpl });
    expect(result.status).toBe('pass');
  });

  it('warns when free bytes are under 1 GB', async () => {
    const statfsImpl = (async () => ({
      bavail: 100,
      bsize: 1024 * 1024,
    })) as unknown as typeof import('fs/promises').statfs;
    const result = await checkDiskSpace({ statfsImpl });
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/MB free/);
  });

  it('skips when statfs throws', async () => {
    const statfsImpl = (async () => {
      throw new Error('not supported');
    }) as unknown as typeof import('fs/promises').statfs;
    const result = await checkDiskSpace({ statfsImpl });
    expect(result.status).toBe('skip');
  });
});

describe('checkNetworkReachable', () => {
  it('passes when github responds 200', async () => {
    const fetchImpl = (async () => fakeResponse({}, 200)) as unknown as typeof fetch;
    const result = await checkNetworkReachable({ fetchImpl });
    expect(result.status).toBe('pass');
  });

  it('warns when fetch throws (DNS / connectivity)', async () => {
    const fetchImpl = (async () => {
      throw new Error('ENOTFOUND');
    }) as unknown as typeof fetch;
    const result = await checkNetworkReachable({ fetchImpl });
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/github\.com/);
  });

  it('warns when github returns 5xx', async () => {
    const fetchImpl = (async () => fakeResponse({}, 503)) as unknown as typeof fetch;
    const result = await checkNetworkReachable({ fetchImpl });
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/503/);
  });
});

describe('checkSudoReachable', () => {
  it('skips when no tools need sudo', async () => {
    const result = await checkSudoReachable(false);
    expect(result.status).toBe('skip');
  });

  it('skips on win32 even when tools need sudo', async () => {
    const result = await checkSudoReachable(true, { platform: 'win32' });
    expect(result.status).toBe('skip');
  });

  it('passes when sudo -n true succeeds (creds cached)', async () => {
    const result = await checkSudoReachable(true, {
      platform: 'linux',
      spawnImpl: fakeProc(0) as unknown as typeof import('child_process').spawn,
    });
    expect(result.status).toBe('pass');
  });

  it('passes when creds not cached but a TTY is attached (runner will prompt)', async () => {
    const result = await checkSudoReachable(true, {
      platform: 'linux',
      spawnImpl: fakeProc(1) as unknown as typeof import('child_process').spawn,
      isTTY: true,
    });
    expect(result.status).toBe('pass');
  });

  it('warns when creds not cached AND not running in a TTY', async () => {
    const result = await checkSudoReachable(true, {
      platform: 'linux',
      spawnImpl: fakeProc(1) as unknown as typeof import('child_process').spawn,
      isTTY: false,
    });
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/TTY/);
  });
});

describe('planNeedsSudo', () => {
  it('returns false when no tool uses sudo', () => {
    expect(planNeedsSudo([tool({ install: 'brew install fzf' })])).toBe(false);
  });

  it('returns true when an install script uses sudo', () => {
    expect(planNeedsSudo([tool({ install: 'sudo apt-get install -y x' })])).toBe(true);
  });

  it('returns true when only the update script uses sudo', () => {
    expect(
      planNeedsSudo([tool({ install: 'echo hi', update: 'sudo apt-get update' })])
    ).toBe(true);
  });
});

describe('runPreflightChecks', () => {
  it('aggregates all results and surfaces the warnings subset', async () => {
    const remoteDate = new Date(Date.now() + 60 * 60 * 1000);
    const fetchImpl = (async (url: string) => {
      // Clock probe hits 1.1.1.1; network probe hits github.com.
      if (url.includes('1.1.1.1')) return fakeResponse({ date: remoteDate.toUTCString() });
      return fakeResponse({}, 200);
    }) as unknown as typeof fetch;

    const statfsImpl = (async () => ({
      bavail: 10_000,
      bsize: 1024 * 1024 * 1024,
    })) as unknown as typeof import('fs/promises').statfs;

    const result = await runPreflightChecks([tool({ install: 'echo hi' })], {
      fetchImpl,
      statfsImpl,
      platform: 'linux',
      spawnImpl: fakeProc(1) as unknown as typeof import('child_process').spawn,
      isTTY: true,
    });

    expect(result.results).toHaveLength(5);
    expect(result.warnings.map((w) => w.name)).toEqual(['Clock skew']);
  });

  it('returns empty warnings when every probe passes or skips', async () => {
    const fetchImpl = (async () =>
      fakeResponse({ date: new Date().toUTCString() }, 200)) as unknown as typeof fetch;
    const statfsImpl = (async () => ({
      bavail: 10_000,
      bsize: 1024 * 1024 * 1024,
    })) as unknown as typeof import('fs/promises').statfs;

    const result = await runPreflightChecks([tool({ install: 'echo hi' })], {
      fetchImpl,
      statfsImpl,
      platform: 'darwin',
    });

    expect(result.warnings).toEqual([]);
  });
});
