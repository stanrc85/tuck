import { Command } from 'commander';
import { join } from 'path';
import { prompts, logger, isInteractive } from '../ui/index.js';
import { c } from '../ui/theme.js';
import { getTuckDir, pathExists } from '../lib/paths.js';
import { loadBootstrapConfig } from '../lib/bootstrap/parser.js';
import { bootstrapConfigSchema } from '../schemas/bootstrap.schema.js';
import { writeBootstrapToml } from '../lib/bootstrap/tomlWriter.js';
import {
  addToBundle,
  createBundle,
  deleteBundle,
  listBundles,
  removeFromBundle,
  showBundle,
  type MemberStatus,
} from '../lib/bootstrap/bundleOps.js';
import { BootstrapError, NonInteractivePromptError } from '../errors.js';
import type { BootstrapConfig } from '../schemas/bootstrap.schema.js';

interface BaseOptions {
  file?: string;
}

interface DeleteOptions extends BaseOptions {
  yes?: boolean;
}

const resolveConfigPath = (options: BaseOptions): string =>
  options.file ?? join(getTuckDir(), 'bootstrap.toml');

/**
 * Load `bootstrap.toml`. When the file is absent AND the caller didn't
 * pass `--file` explicitly, we treat that as an empty config — that's
 * legal for `list` and `create` (no file to start from) but the editing
 * ops (`show`/`add`/`rm`/`delete`) guard separately because operating
 * on a non-existent bundle would produce a confusing error otherwise.
 */
const loadConfigOrEmpty = async (
  configPath: string,
  options: BaseOptions
): Promise<{ config: BootstrapConfig; existed: boolean }> => {
  const explicit = options.file !== undefined;
  const existed = await pathExists(configPath);
  if (!existed) {
    if (explicit) {
      throw new BootstrapError(`bootstrap.toml not found at ${configPath}`, [
        'Double-check --file points at the right location',
      ]);
    }
    return { config: bootstrapConfigSchema.parse({}), existed: false };
  }
  return { config: await loadBootstrapConfig(configPath), existed: true };
};

const persistConfig = async (
  configPath: string,
  config: BootstrapConfig,
  existedBefore: boolean
): Promise<void> => {
  const result = await writeBootstrapToml(configPath, config);
  logger.success(`Wrote ${existedBefore ? 'updated' : 'new'} ${configPath}`);
  if (result.hadCommentsBefore) {
    logger.warning(
      'Existing comments in bootstrap.toml were not preserved (TOML round-trip reflows the document).'
    );
    logger.info('Back up the file before running bundle edits if you rely on hand-written comments.');
  }
};

const runList = async (options: BaseOptions): Promise<void> => {
  const configPath = resolveConfigPath(options);
  const { config } = await loadConfigOrEmpty(configPath, options);

  prompts.intro('tuck bootstrap bundle list');

  const bundles = listBundles(config);
  if (bundles.length === 0) {
    prompts.log.info('No bundles defined.');
    prompts.note(
      'Create one with: tuck bootstrap bundle create <name> <tool> [tool...]',
      'Tip'
    );
    prompts.outro('');
    return;
  }

  console.log();
  for (const b of bundles) {
    console.log(
      c.cyan(`  ${b.name}`) +
        c.dim(` — ${b.memberCount} tool${b.memberCount === 1 ? '' : 's'}`)
    );
  }
  console.log();
  prompts.outro(`${bundles.length} bundle${bundles.length === 1 ? '' : 's'}`);
};

const STATUS_GLYPH: Record<MemberStatus, string> = {
  installed: c.green('✓ installed'),
  detected: c.cyan('● detected'),
  missing: c.yellow('○ missing'),
  unknown: c.red('? unknown'),
};

const runShow = async (bundleName: string, options: BaseOptions): Promise<void> => {
  const configPath = resolveConfigPath(options);
  const { config } = await loadConfigOrEmpty(configPath, options);
  const catalog = config.tool;

  prompts.intro(`tuck bootstrap bundle show ${bundleName}`);

  const details = await showBundle(config, catalog, bundleName);

  console.log();
  for (const m of details.members) {
    const desc = m.description ? c.dim(` — ${m.description}`) : '';
    console.log(`  ${c.bold(m.id)}${desc}`);
    console.log(`    ${STATUS_GLYPH[m.status]}`);
  }
  console.log();
  prompts.outro(`${details.members.length} member${details.members.length === 1 ? '' : 's'}`);
};

const runCreate = async (
  bundleName: string,
  members: string[],
  options: BaseOptions
): Promise<void> => {
  const configPath = resolveConfigPath(options);
  const { config, existed } = await loadConfigOrEmpty(configPath, options);
  const catalog = config.tool;

  prompts.intro(`tuck bootstrap bundle create ${bundleName}`);

  const updated = createBundle(config, catalog, bundleName, members);
  await persistConfig(configPath, updated, existed);
  prompts.outro(
    `Created bundle "${bundleName}" with ${members.length} tool${members.length === 1 ? '' : 's'}`
  );
};

const runAdd = async (
  bundleName: string,
  toolId: string,
  options: BaseOptions
): Promise<void> => {
  const configPath = resolveConfigPath(options);
  const { config, existed } = await loadConfigOrEmpty(configPath, options);
  if (!existed) {
    throw new BootstrapError(`bootstrap.toml not found at ${configPath}`, [
      'Create one first with `tuck bootstrap bundle create`',
    ]);
  }
  const catalog = config.tool;

  prompts.intro(`tuck bootstrap bundle add ${bundleName} ${toolId}`);

  const { config: updated, alreadyMember } = addToBundle(config, catalog, bundleName, toolId);
  if (alreadyMember) {
    logger.info(`"${toolId}" is already a member of "${bundleName}"`);
    prompts.outro('No changes');
    return;
  }

  await persistConfig(configPath, updated, existed);
  prompts.outro(`Added "${toolId}" to "${bundleName}"`);
};

const runRemove = async (
  bundleName: string,
  toolId: string,
  options: BaseOptions
): Promise<void> => {
  const configPath = resolveConfigPath(options);
  const { config, existed } = await loadConfigOrEmpty(configPath, options);
  if (!existed) {
    throw new BootstrapError(`bootstrap.toml not found at ${configPath}`, [
      'Nothing to remove from a non-existent file',
    ]);
  }

  prompts.intro(`tuck bootstrap bundle rm ${bundleName} ${toolId}`);

  const { config: updated, wasMember } = removeFromBundle(config, bundleName, toolId);
  if (!wasMember) {
    logger.info(`"${toolId}" is not a member of "${bundleName}"`);
    prompts.outro('No changes');
    return;
  }

  await persistConfig(configPath, updated, existed);
  prompts.outro(`Removed "${toolId}" from "${bundleName}"`);
};

const runDelete = async (bundleName: string, options: DeleteOptions): Promise<void> => {
  const configPath = resolveConfigPath(options);
  const { config, existed } = await loadConfigOrEmpty(configPath, options);
  if (!existed) {
    throw new BootstrapError(`bootstrap.toml not found at ${configPath}`, [
      'Nothing to delete from a non-existent file',
    ]);
  }

  prompts.intro(`tuck bootstrap bundle delete ${bundleName}`);

  // Peek first so the missing-bundle error fires before the TTY/confirm check —
  // better UX than prompting the user to confirm a delete that'll fail anyway.
  if (!(bundleName in config.bundles)) {
    throw new BootstrapError(`No bundle named "${bundleName}"`, [
      `Known bundles: ${Object.keys(config.bundles).sort().join(', ') || '(none)'}`,
    ]);
  }

  if (!options.yes) {
    if (!isInteractive()) {
      throw new NonInteractivePromptError('tuck bootstrap bundle delete', [
        'Pass -y/--yes to skip the confirmation prompt',
      ]);
    }
    const confirm = await prompts.confirm(
      `Delete bundle "${bundleName}"? This does not uninstall any tools.`,
      false
    );
    if (!confirm) {
      prompts.cancel('Cancelled');
      return;
    }
  }

  const updated = deleteBundle(config, bundleName);
  await persistConfig(configPath, updated, existed);
  prompts.outro(`Deleted bundle "${bundleName}"`);
};

export const bundleCommand = new Command('bundle')
  .description('Manage named tool bundles in bootstrap.toml')
  .addCommand(
    new Command('list')
      .description('List bundles and their member counts')
      .option('-f, --file <path>', 'Path to bootstrap.toml')
      .action(async function (this: Command) {
        await runList(this.optsWithGlobals() as BaseOptions);
      })
  )
  .addCommand(
    new Command('show')
      .description('Show members of a bundle with installed/detected status')
      .argument('<name>', 'Bundle name')
      .option('-f, --file <path>', 'Path to bootstrap.toml')
      .action(async function (this: Command, name: string) {
        await runShow(name, this.optsWithGlobals() as BaseOptions);
      })
  )
  .addCommand(
    new Command('create')
      .description('Create a new bundle from one or more tool ids')
      .argument('<name>', 'Bundle name')
      .argument('<tools...>', 'Tool ids (must exist in the merged catalog)')
      .option('-f, --file <path>', 'Path to bootstrap.toml')
      .action(async function (this: Command, name: string, tools: string[]) {
        await runCreate(name, tools, this.optsWithGlobals() as BaseOptions);
      })
  )
  .addCommand(
    new Command('add')
      .description('Add a tool to an existing bundle (idempotent)')
      .argument('<name>', 'Bundle name')
      .argument('<tool>', 'Tool id')
      .option('-f, --file <path>', 'Path to bootstrap.toml')
      .action(async function (this: Command, name: string, tool: string) {
        await runAdd(name, tool, this.optsWithGlobals() as BaseOptions);
      })
  )
  .addCommand(
    new Command('rm')
      .description('Remove a tool from a bundle (idempotent)')
      .argument('<name>', 'Bundle name')
      .argument('<tool>', 'Tool id')
      .option('-f, --file <path>', 'Path to bootstrap.toml')
      .action(async function (this: Command, name: string, tool: string) {
        await runRemove(name, tool, this.optsWithGlobals() as BaseOptions);
      })
  )
  .addCommand(
    new Command('delete')
      .description('Delete a bundle entirely (tools are not uninstalled)')
      .argument('<name>', 'Bundle name')
      .option('-f, --file <path>', 'Path to bootstrap.toml')
      .option('-y, --yes', 'Skip the confirmation prompt')
      .action(async function (this: Command, name: string) {
        await runDelete(name, this.optsWithGlobals() as DeleteOptions);
      })
  );

// Export runners for direct testing.
export {
  runList as runBundleList,
  runShow as runBundleShow,
  runCreate as runBundleCreate,
  runAdd as runBundleAdd,
  runRemove as runBundleRemove,
  runDelete as runBundleDelete,
};
