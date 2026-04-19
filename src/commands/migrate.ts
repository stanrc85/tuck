import { Command } from 'commander';
import { hostname } from 'os';
import { prompts, logger } from '../ui/index.js';
import { getTuckDir } from '../lib/paths.js';
import {
  loadManifest,
  saveManifest,
  requiresMigration,
} from '../lib/manifest.js';
import { loadConfig, saveLocalConfig } from '../lib/config.js';
import { CURRENT_MANIFEST_VERSION } from '../schemas/manifest.schema.js';
import { NotInitializedError, ValidationError } from '../errors.js';

export interface MigrateOptions {
  group?: string[];
  yes?: boolean;
}

const parseGroupList = (input: string): string[] =>
  input
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean);

const applyGroups = (
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  groups: string[]
): number => {
  let tagged = 0;
  for (const file of Object.values(manifest.files)) {
    if (!file.groups || file.groups.length === 0) {
      file.groups = [...groups];
      tagged++;
    }
  }
  manifest.version = CURRENT_MANIFEST_VERSION;
  return tagged;
};

export const runMigrate = async (options: MigrateOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }

  if (!requiresMigration(manifest)) {
    logger.success('Manifest is already on the current schema');
    logger.dim(`Version: ${manifest.version}`);
    return;
  }

  const fileCount = Object.keys(manifest.files).length;
  const untagged = Object.values(manifest.files).filter(
    (f) => !f.groups || f.groups.length === 0
  ).length;

  let groups: string[] = options.group ?? [];

  if (groups.length === 0) {
    if (options.yes || !process.stdout.isTTY) {
      // Non-interactive fallback: use hostname as the single group.
      groups = [hostname()];
    } else {
      prompts.intro('tuck migrate');
      prompts.log.info(
        `Manifest on version ${manifest.version}; current is ${CURRENT_MANIFEST_VERSION}.`
      );
      if (untagged > 0) {
        prompts.log.info(
          `${untagged} of ${fileCount} tracked file${fileCount === 1 ? '' : 's'} need host-groups.`
        );
      }
      const input = await prompts.text('Host-group name(s) for existing files:', {
        placeholder: hostname(),
        defaultValue: hostname(),
        validate: (value) => {
          const parsed = parseGroupList(value);
          if (parsed.length === 0) return 'At least one group is required';
          return undefined;
        },
      });
      groups = parseGroupList(input);
    }
  }

  if (groups.length === 0) {
    throw new ValidationError('group', 'at least one host-group is required');
  }

  const tagged = applyGroups(manifest, groups);
  await saveManifest(manifest, tuckDir);

  // Seed defaultGroups in the host-local config so subsequent `tuck add`/`tuck
  // sync` calls without -g default sensibly on this host. Writing to
  // `.tuckrc.local.json` (gitignored) instead of the shared `.tuckrc.json`
  // prevents this per-host value from leaking to other machines via a synced
  // dotfiles repo.
  const config = await loadConfig(tuckDir);
  if (!config.defaultGroups || config.defaultGroups.length === 0) {
    await saveLocalConfig({ defaultGroups: groups }, tuckDir);
  }

  if (process.stdout.isTTY && !options.yes && (options.group?.length ?? 0) === 0) {
    prompts.log.success(
      tagged > 0
        ? `Tagged ${tagged} file${tagged === 1 ? '' : 's'} with group${
            groups.length === 1 ? '' : 's'
          }: ${groups.join(', ')}`
        : `Bumped manifest to ${CURRENT_MANIFEST_VERSION}`
    );
    prompts.outro('Migration complete');
  } else {
    logger.success(
      `Migrated manifest to ${CURRENT_MANIFEST_VERSION}; tagged ${tagged} file${
        tagged === 1 ? '' : 's'
      } with: ${groups.join(', ')}`
    );
  }
};

export const migrateCommand = new Command('migrate')
  .description('Migrate manifest to the current schema (adds host-groups)')
  .option(
    '-g, --group <name>',
    'Host-group to assign to untagged files (repeatable)',
    (value: string, previous: string[] = []) => [...previous, ...parseGroupList(value)],
    []
  )
  .option('-y, --yes', 'Skip prompts (use hostname as default group)')
  .action(async (options: MigrateOptions) => {
    await runMigrate(options);
  });
