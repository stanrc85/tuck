import { Command } from 'commander';
import { prompts, logger, colors as c, formatCount } from '../ui/index.js';
import { getTuckDir, expandPath, collapsePath } from '../lib/paths.js';
import {
  loadManifest,
  saveManifest,
  assertMigrated,
  getAllGroups,
  getTrackedFileBySource,
} from '../lib/manifest.js';
import {
  NotInitializedError,
  FileNotTrackedError,
  ValidationError,
} from '../errors.js';

const ensureReady = async () => {
  const tuckDir = getTuckDir();
  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);
  return { tuckDir, manifest };
};

const resolveTargetIds = async (
  tuckDir: string,
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  paths: string[]
): Promise<string[]> => {
  if (paths.length > 0) {
    const ids: string[] = [];
    for (const p of paths) {
      const collapsed = collapsePath(expandPath(p));
      const tracked = await getTrackedFileBySource(tuckDir, collapsed);
      if (!tracked) {
        throw new FileNotTrackedError(p);
      }
      ids.push(tracked.id);
    }
    return ids;
  }

  // Interactive multiselect over all tracked files.
  const options = Object.entries(manifest.files).map(([id, file]) => ({
    value: id,
    label: file.source,
    hint: file.groups?.join(', ') || '(no groups)',
  }));
  if (options.length === 0) {
    throw new ValidationError('paths', 'no tracked files to modify');
  }
  const selected = await prompts.multiselect('Select files:', options, {
    required: true,
  });
  return selected;
};

const runGroupAdd = async (group: string, paths: string[]): Promise<void> => {
  if (!group.trim()) {
    throw new ValidationError('group', 'group name cannot be empty');
  }
  const { tuckDir, manifest } = await ensureReady();
  const ids = await resolveTargetIds(tuckDir, manifest, paths);

  let changed = 0;
  for (const id of ids) {
    const file = manifest.files[id];
    if (!file.groups.includes(group)) {
      file.groups = [...file.groups, group];
      changed++;
    }
  }

  if (changed === 0) {
    logger.info(`No files needed the "${group}" group (already tagged)`);
    return;
  }

  await saveManifest(manifest, tuckDir);
  logger.success(
    `Tagged ${formatCount(changed, 'file')} with group "${group}"`
  );
};

const runGroupRemove = async (group: string, paths: string[]): Promise<void> => {
  if (!group.trim()) {
    throw new ValidationError('group', 'group name cannot be empty');
  }
  const { tuckDir, manifest } = await ensureReady();
  const ids = await resolveTargetIds(tuckDir, manifest, paths);

  let changed = 0;
  const violations: string[] = [];
  for (const id of ids) {
    const file = manifest.files[id];
    if (!file.groups.includes(group)) continue;

    if (file.groups.length === 1) {
      // Would leave the file with zero groups, which is the pre-migration state.
      violations.push(file.source);
      continue;
    }

    file.groups = file.groups.filter((g) => g !== group);
    changed++;
  }

  if (violations.length > 0) {
    logger.error(
      `Cannot remove "${group}" from the following — they would be left with no groups:`
    );
    violations.forEach((src) => logger.dim(`  • ${src}`));
    logger.info(
      'Add another group first (tuck group add <other> <path>) or untrack the file.'
    );
    if (changed === 0) return;
  }

  if (changed === 0) {
    logger.info(`No files had the "${group}" group`);
    return;
  }

  await saveManifest(manifest, tuckDir);
  logger.success(
    `Removed "${group}" from ${formatCount(changed, 'file')}`
  );
};

const runGroupList = async (): Promise<void> => {
  const { tuckDir, manifest } = await ensureReady();
  const groups = await getAllGroups(tuckDir);

  prompts.intro('tuck group list');

  if (groups.length === 0) {
    prompts.log.warning('No groups defined');
    prompts.outro('');
    return;
  }

  const counts = new Map<string, number>();
  for (const file of Object.values(manifest.files)) {
    for (const g of file.groups ?? []) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }

  console.log();
  for (const group of groups) {
    const n = counts.get(group) ?? 0;
    console.log(
      c.cyan(`  ${group}`) + c.dim(` — ${formatCount(n, 'file')}`)
    );
  }
  console.log();
  prompts.outro(`${formatCount(groups.length, 'group')}`);
};

const runGroupShow = async (group: string): Promise<void> => {
  if (!group.trim()) {
    throw new ValidationError('group', 'group name cannot be empty');
  }
  const { manifest } = await ensureReady();

  const matches = Object.values(manifest.files).filter((f) =>
    (f.groups ?? []).includes(group)
  );

  prompts.intro(`tuck group show ${group}`);

  if (matches.length === 0) {
    prompts.log.warning(`No files in group "${group}"`);
    prompts.outro('');
    return;
  }

  console.log();
  for (const file of matches) {
    console.log(c.cyan(`  ${file.source}`) + c.dim(` — ${file.category}`));
  }
  console.log();
  prompts.outro(`${formatCount(matches.length, 'file')} in "${group}"`);
};

export const groupCommand = new Command('group')
  .description('Manage host-groups on tracked files')
  .addCommand(
    new Command('add')
      .description('Tag files with a group')
      .argument('<group>', 'Group name')
      .argument('[paths...]', 'Files to tag (interactive if omitted)')
      .action(async (group: string, paths: string[]) => {
        await runGroupAdd(group, paths);
      })
  )
  .addCommand(
    new Command('rm')
      .description('Remove a group tag from files')
      .argument('<group>', 'Group name')
      .argument('[paths...]', 'Files to untag (interactive if omitted)')
      .action(async (group: string, paths: string[]) => {
        await runGroupRemove(group, paths);
      })
  )
  .addCommand(
    new Command('list')
      .description('List all groups and their file counts')
      .action(async () => {
        await runGroupList();
      })
  )
  .addCommand(
    new Command('show')
      .description('Show files in a group')
      .argument('<group>', 'Group name')
      .action(async (group: string) => {
        await runGroupShow(group);
      })
  );
