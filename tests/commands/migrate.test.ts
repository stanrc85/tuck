import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { runMigrate } from '../../src/commands/migrate.js';
import { clearManifestCache, loadManifest } from '../../src/lib/manifest.js';
import { clearConfigCache, loadConfig } from '../../src/lib/config.js';
import { TEST_TUCK_DIR } from '../setup.js';
import { createMockManifest, createMockTrackedFile } from '../utils/factories.js';

const writeManifest = (
  manifest: ReturnType<typeof createMockManifest>
): void => {
  vol.writeFileSync(
    join(TEST_TUCK_DIR, '.tuckmanifest.json'),
    JSON.stringify(manifest)
  );
};

const run = async (groups: string[]): Promise<void> => {
  await runMigrate({ group: groups, yes: true });
};

describe('tuck migrate', () => {
  beforeEach(() => {
    vol.reset();
    clearManifestCache();
    clearConfigCache();
    vol.mkdirSync(TEST_TUCK_DIR, { recursive: true });
  });

  afterEach(() => {
    vol.reset();
    clearManifestCache();
    clearConfigCache();
  });

  it('tags existing v1 files with the provided groups and bumps version', async () => {
    writeManifest(
      createMockManifest({
        version: '1.0.0',
        files: {
          f1: createMockTrackedFile({ source: '~/.zshrc', groups: [] }),
          f2: createMockTrackedFile({ source: '~/.bashrc', groups: [] }),
        },
      })
    );

    await run(['kubuntu']);

    const migrated = await loadManifest(TEST_TUCK_DIR);
    expect(migrated.version).toBe('2.0.0');
    expect(migrated.files.f1.groups).toEqual(['kubuntu']);
    expect(migrated.files.f2.groups).toEqual(['kubuntu']);
  });

  it('accepts multiple -g flags', async () => {
    writeManifest(
      createMockManifest({
        version: '1.0.0',
        files: {
          f1: createMockTrackedFile({ groups: [] }),
        },
      })
    );

    await run(['home', 'laptop']);

    const migrated = await loadManifest(TEST_TUCK_DIR);
    expect(migrated.files.f1.groups).toEqual(['home', 'laptop']);
  });

  it('seeds config.defaultGroups when unset', async () => {
    writeManifest(
      createMockManifest({
        version: '1.0.0',
        files: {
          f1: createMockTrackedFile({ groups: [] }),
        },
      })
    );

    await run(['work']);

    const config = await loadConfig(TEST_TUCK_DIR);
    expect(config.defaultGroups).toEqual(['work']);
  });

  it('leaves already-tagged files untouched while bumping version', async () => {
    writeManifest(
      createMockManifest({
        version: '1.0.0',
        files: {
          f1: createMockTrackedFile({ groups: ['home'] }),
          f2: createMockTrackedFile({ source: '~/.bashrc', groups: [] }),
        },
      })
    );

    await run(['laptop']);

    const migrated = await loadManifest(TEST_TUCK_DIR);
    expect(migrated.files.f1.groups).toEqual(['home']); // preserved
    expect(migrated.files.f2.groups).toEqual(['laptop']); // newly tagged
    expect(migrated.version).toBe('2.0.0');
  });

  it('is idempotent — running twice does nothing on an already-migrated manifest', async () => {
    writeManifest(
      createMockManifest({
        version: '2.0.0',
        files: {
          f1: createMockTrackedFile({ groups: ['home'] }),
        },
      })
    );

    await run(['home']);
    await run(['home']);

    const migrated = await loadManifest(TEST_TUCK_DIR);
    expect(migrated.version).toBe('2.0.0');
    expect(migrated.files.f1.groups).toEqual(['home']);
  });
});
