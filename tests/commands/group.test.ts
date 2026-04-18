import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { groupCommand } from '../../src/commands/group.js';
import { clearManifestCache, loadManifest } from '../../src/lib/manifest.js';
import { MigrationRequiredError } from '../../src/errors.js';
import { TEST_TUCK_DIR } from '../setup.js';
import { createMockManifest, createMockTrackedFile } from '../utils/factories.js';

const writeManifest = (
  files: Record<string, ReturnType<typeof createMockTrackedFile>>
): void => {
  vol.writeFileSync(
    join(TEST_TUCK_DIR, '.tuckmanifest.json'),
    JSON.stringify(createMockManifest({ version: '2.0.0', files }))
  );
};

const run = async (...args: string[]): Promise<void> => {
  await groupCommand.parseAsync(['node', 'group', ...args]);
};

describe('tuck group', () => {
  beforeEach(() => {
    vol.reset();
    clearManifestCache();
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
  });

  afterEach(() => {
    vol.reset();
    clearManifestCache();
  });

  describe('add', () => {
    it('tags listed files with the new group', async () => {
      writeManifest({
        zshrc: createMockTrackedFile({ source: '~/.zshrc', groups: ['home'] }),
      });

      await run('add', 'work', '~/.zshrc');

      const m = await loadManifest(TEST_TUCK_DIR);
      expect(m.files.zshrc.groups).toEqual(['home', 'work']);
    });

    it('is a no-op when the file is already tagged', async () => {
      writeManifest({
        zshrc: createMockTrackedFile({ source: '~/.zshrc', groups: ['home'] }),
      });

      await run('add', 'home', '~/.zshrc');

      const m = await loadManifest(TEST_TUCK_DIR);
      expect(m.files.zshrc.groups).toEqual(['home']);
    });

    it('refuses an untracked path', async () => {
      writeManifest({
        zshrc: createMockTrackedFile({ source: '~/.zshrc', groups: ['home'] }),
      });

      await expect(run('add', 'work', '~/.bashrc')).rejects.toThrow(/not tracked/i);
    });
  });

  describe('rm', () => {
    it('removes a group from listed files', async () => {
      writeManifest({
        zshrc: createMockTrackedFile({ source: '~/.zshrc', groups: ['home', 'work'] }),
      });

      await run('rm', 'work', '~/.zshrc');

      const m = await loadManifest(TEST_TUCK_DIR);
      expect(m.files.zshrc.groups).toEqual(['home']);
    });

    it('refuses to leave a file with zero groups', async () => {
      writeManifest({
        zshrc: createMockTrackedFile({ source: '~/.zshrc', groups: ['home'] }),
      });

      await run('rm', 'home', '~/.zshrc');

      // groups should be unchanged because removal was blocked by the invariant
      const m = await loadManifest(TEST_TUCK_DIR);
      expect(m.files.zshrc.groups).toEqual(['home']);
    });

    it('allows removal when other groups remain on other files', async () => {
      writeManifest({
        zshrc: createMockTrackedFile({ source: '~/.zshrc', groups: ['home', 'work'] }),
        bashrc: createMockTrackedFile({ source: '~/.bashrc', groups: ['home'] }),
      });

      await run('rm', 'work', '~/.zshrc');

      const m = await loadManifest(TEST_TUCK_DIR);
      expect(m.files.zshrc.groups).toEqual(['home']);
      expect(m.files.bashrc.groups).toEqual(['home']);
    });
  });

  describe('gate', () => {
    it('blocks group subcommands on a pre-migration manifest', async () => {
      vol.writeFileSync(
        join(TEST_TUCK_DIR, '.tuckmanifest.json'),
        JSON.stringify(
          createMockManifest({
            version: '1.0.0',
            files: { zshrc: createMockTrackedFile({ groups: [] }) },
          })
        )
      );

      await expect(run('list')).rejects.toThrow(MigrationRequiredError);
    });
  });
});
