import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { clearManifestCache } from '../../src/lib/manifest.js';
import { TEST_HOME, TEST_TUCK_DIR } from '../setup.js';
import { createMockManifest, createMockTrackedFile } from '../utils/factories.js';

const promptConfirmMock = vi.fn();

vi.mock('../../src/ui/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/ui/index.js')>(
    '../../src/ui/index.js',
  );
  return {
    ...actual,
    prompts: {
      ...actual.prompts,
      intro: vi.fn(),
      outro: vi.fn(),
      confirm: promptConfirmMock,
    },
  };
});

const writeManifestAndFile = (
  source: string,
  destination: string,
  content: string,
): void => {
  const manifest = createMockManifest();
  manifest.files[destination.replace(/[^a-zA-Z0-9]/g, '_')] = createMockTrackedFile({
    source,
    destination,
  });
  vol.writeFileSync(
    join(TEST_TUCK_DIR, '.tuckmanifest.json'),
    JSON.stringify(manifest),
  );
  const abs = source.replace('~', TEST_HOME);
  vol.mkdirSync(abs.split('/').slice(0, -1).join('/'), { recursive: true });
  vol.writeFileSync(abs, content);
};

describe('validate command', () => {
  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    clearManifestCache();
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vol.reset();
    clearManifestCache();
    process.exitCode = undefined;
  });

  describe('safety invariants for --fix', () => {
    it('refuses to write in non-TTY mode without --yes, even with fixable content', async () => {
      writeManifestAndFile('~/.myrc.json', 'files/myrc.json', '{"ok": true}   \n');
      const { runValidate } = await import('../../src/commands/validate.js');
      await runValidate([], { fix: true, format: 'text' });

      // File must be unchanged.
      const after = vol.readFileSync(`${TEST_HOME}/.myrc.json`, 'utf-8');
      expect(after).toBe('{"ok": true}   \n');
      expect(promptConfirmMock).not.toHaveBeenCalled();
    });

    it('does not write when the user declines the confirm prompt', async () => {
      // Force isTTY true so the confirm path fires.
      const restore = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      try {
        writeManifestAndFile('~/.myrc.json', 'files/myrc.json', '{"ok": true}   \n');
        promptConfirmMock.mockResolvedValueOnce(false);
        const { runValidate } = await import('../../src/commands/validate.js');
        await runValidate([], { fix: true, format: 'text' });

        const after = vol.readFileSync(`${TEST_HOME}/.myrc.json`, 'utf-8');
        expect(after).toBe('{"ok": true}   \n');
        expect(promptConfirmMock).toHaveBeenCalledOnce();
      } finally {
        if (restore) Object.defineProperty(process.stdout, 'isTTY', restore);
      }
    });

    it('writes + snapshots when --yes is passed', async () => {
      writeManifestAndFile(
        '~/.myrc.json',
        'files/myrc.json',
        '{"ok": true}   \n',
      );
      const { runValidate } = await import('../../src/commands/validate.js');
      await runValidate([], { fix: true, yes: true, format: 'text' });

      const after = vol.readFileSync(`${TEST_HOME}/.myrc.json`, 'utf-8');
      expect(after).toBe('{"ok": true}\n');

      // Snapshot should have been created under the backup dir.
      const snapshotRoot = `${TEST_HOME}/.tuck-backups`;
      expect(vol.existsSync(snapshotRoot)).toBe(true);
      const ids = vol.readdirSync(snapshotRoot);
      expect(ids.length).toBeGreaterThan(0);
    });

    it('leaves the file alone when there are no fixable issues (--yes no-op)', async () => {
      writeManifestAndFile('~/.myrc.json', 'files/myrc.json', '{"ok": true}\n');
      const { runValidate } = await import('../../src/commands/validate.js');
      await runValidate([], { fix: true, yes: true, format: 'text' });

      const after = vol.readFileSync(`${TEST_HOME}/.myrc.json`, 'utf-8');
      expect(after).toBe('{"ok": true}\n');
    });
  });

  describe('validator dispatch', () => {
    it('passes valid JSON without error exit', async () => {
      writeManifestAndFile('~/.good.json', 'files/good.json', '{"ok": true}\n');
      const { runValidate } = await import('../../src/commands/validate.js');
      await runValidate([], { format: 'text' });
      expect(process.exitCode).not.toBe(1);
    });

    it('fails invalid JSON with exit code 1', async () => {
      writeManifestAndFile('~/.bad.json', 'files/bad.json', '{oops}\n');
      const { runValidate } = await import('../../src/commands/validate.js');
      await runValidate([], { format: 'text' });
      expect(process.exitCode).toBe(1);
    });

    it('emits JSON report when --format json', async () => {
      writeManifestAndFile('~/.good.json', 'files/good.json', '{"ok": true}\n');
      const { runValidate } = await import('../../src/commands/validate.js');
      const chunks: string[] = [];
      const orig = console.log;
      // eslint-disable-next-line no-console
      console.log = (...args: unknown[]) => chunks.push(args.map(String).join(' '));
      try {
        await runValidate([], { format: 'json' });
      } finally {
        // eslint-disable-next-line no-console
        console.log = orig;
      }
      const combined = chunks.join('\n');
      // Report must parse as a single JSON document.
      const parsed = JSON.parse(combined);
      expect(parsed.summary).toBeDefined();
      expect(parsed.results).toBeInstanceOf(Array);
    });
  });
});
