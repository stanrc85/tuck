import { describe, it, expect } from 'vitest';
import { vol } from 'memfs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { createOutputContext, LOGS_DIRNAME } from '../../src/lib/output.js';

const TUCK_DIR = '/test-home/.tuck';

const fixedNow = (): Date => new Date('2026-05-06T18:23:45.000Z');

describe('createOutputContext', () => {
  it('creates the logs directory and returns a writable file path', async () => {
    vol.fromJSON({ [`${TUCK_DIR}/.gitignore`]: '' });
    const ctx = await createOutputContext({
      command: 'bootstrap',
      tuckDir: TUCK_DIR,
      verbose: false,
      now: fixedNow,
    });
    try {
      expect(ctx.logPath).toBe(
        join(TUCK_DIR, LOGS_DIRNAME, 'bootstrap-2026-05-06T18-23-45-000Z.log')
      );
      expect(vol.existsSync(join(TUCK_DIR, LOGS_DIRNAME))).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('writes the header lines to the log file', async () => {
    vol.fromJSON({ [`${TUCK_DIR}/.gitignore`]: '' });
    const ctx = await createOutputContext({
      command: 'restore',
      tuckDir: TUCK_DIR,
      verbose: true,
      now: fixedNow,
    });
    ctx.log('phase', 'started');
    await ctx.close();
    const contents = await readFile(ctx.logPath, 'utf-8');
    expect(contents).toContain('tuck restore');
    expect(contents).toContain('verbose=true');
    expect(contents).toContain('[phase] started');
  });

  it('appends `logs/` to .gitignore when missing', async () => {
    vol.fromJSON({ [`${TUCK_DIR}/.gitignore`]: '*.log\n' });
    const ctx = await createOutputContext({
      command: 'bootstrap',
      tuckDir: TUCK_DIR,
      verbose: false,
      now: fixedNow,
    });
    await ctx.close();
    const gitignore = await readFile(join(TUCK_DIR, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('logs/');
    expect(gitignore).toContain('*.log');
  });

  it('is idempotent — does not duplicate the `logs/` entry', async () => {
    vol.fromJSON({
      [`${TUCK_DIR}/.gitignore`]: '# existing\nlogs/\n',
    });
    const ctx = await createOutputContext({
      command: 'bootstrap',
      tuckDir: TUCK_DIR,
      verbose: false,
      now: fixedNow,
    });
    await ctx.close();
    const gitignore = await readFile(join(TUCK_DIR, '.gitignore'), 'utf-8');
    const occurrences = gitignore.split(/\r?\n/).filter((l) => l.trim() === 'logs/').length;
    expect(occurrences).toBe(1);
  });

  it('creates a fresh .gitignore with `logs/` when one is missing', async () => {
    vol.fromJSON({ [`${TUCK_DIR}/.placeholder`]: '' });
    const ctx = await createOutputContext({
      command: 'bootstrap',
      tuckDir: TUCK_DIR,
      verbose: false,
      now: fixedNow,
    });
    await ctx.close();
    const gitignore = await readFile(join(TUCK_DIR, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('logs/');
  });

  it('close() is idempotent and safe to call multiple times', async () => {
    vol.fromJSON({ [`${TUCK_DIR}/.gitignore`]: '' });
    const ctx = await createOutputContext({
      command: 'bootstrap',
      tuckDir: TUCK_DIR,
      verbose: false,
      now: fixedNow,
    });
    await ctx.close();
    await expect(ctx.close()).resolves.toBeUndefined();
  });

  it('embeds an ISO-safe timestamp in the filename', async () => {
    vol.fromJSON({ [`${TUCK_DIR}/.gitignore`]: '' });
    const ctx = await createOutputContext({
      command: 'bootstrap-update',
      tuckDir: TUCK_DIR,
      verbose: false,
      now: fixedNow,
    });
    try {
      // No `:` or `.` in the timestamp segment — those break filenames on
      // Windows and look surprising on Linux. Replaced with `-`. The `.log`
      // extension is the only `.` we tolerate.
      const filename = ctx.logPath.split(/[/\\]/).pop()!;
      const stamp = filename.replace(/^bootstrap-update-/, '').replace(/\.log$/, '');
      expect(stamp).not.toMatch(/[:.]/);
    } finally {
      await ctx.close();
    }
  });
});
