import { Command } from 'commander';
import { basename, sep } from 'path';
import { prompts, formatCount, colors as c } from '../ui/index.js';
import { getTuckDir } from '../lib/paths.js';
import {
  loadManifest,
  getAllTrackedFiles,
  assertMigrated,
  fileMatchesGroups,
} from '../lib/manifest.js';
import { resolveGroupFilter } from '../lib/groupFilter.js';
import { NotInitializedError } from '../errors.js';
import { CATEGORIES } from '../constants.js';
import type { ListOptions } from '../types.js';

const collectGroup = (value: string, previous: string[] = []): string[] => [
  ...previous,
  ...value
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean),
];

interface CategoryGroup {
  name: string;
  icon: string;
  files: {
    id: string;
    source: string;
    destination: string;
    isDir: boolean;
    groups: string[];
  }[];
}

const groupByCategory = async (
  tuckDir: string,
  filterGroups?: string[]
): Promise<CategoryGroup[]> => {
  const files = await getAllTrackedFiles(tuckDir);
  const groups: Map<string, CategoryGroup> = new Map();

  for (const [id, file] of Object.entries(files)) {
    if (!fileMatchesGroups(file, filterGroups)) continue;

    const category = file.category;
    const categoryConfig = CATEGORIES[category] || { icon: '📄' };

    if (!groups.has(category)) {
      groups.set(category, {
        name: category,
        icon: categoryConfig.icon,
        files: [],
      });
    }

    groups.get(category)!.files.push({
      id,
      source: file.source,
      destination: file.destination,
      // Handle both Unix (/) and Windows (\) path separators for directory detection
      isDir: file.destination.endsWith('/') || file.destination.endsWith(sep) || basename(file.destination) === 'nvim',
      groups: file.groups ?? [],
    });
  }

  // Sort groups by name and files within each group
  return Array.from(groups.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((group) => ({
      ...group,
      files: group.files.sort((a, b) => a.source.localeCompare(b.source)),
    }));
};

interface PrintListContext {
  categoryFilter?: string;
  filterGroups?: string[];
}

const printList = (groups: CategoryGroup[], ctx: PrintListContext = {}): void => {
  prompts.intro('tuck list');

  if (groups.length === 0) {
    if (ctx.categoryFilter) {
      prompts.outro(`No files in category '${ctx.categoryFilter}'`);
      return;
    }
    if (ctx.filterGroups && ctx.filterGroups.length > 0) {
      prompts.outro(`No files in group(s): ${ctx.filterGroups.join(', ')}`);
      return;
    }
    prompts.log.message(c.dim("Run `tuck add <path>` to start tracking files"));
    prompts.outro('No files are currently tracked');
    return;
  }

  let totalFiles = 0;

  for (const group of groups) {
    const fileCount = group.files.length;
    totalFiles += fileCount;

    const header =
      c.bold(`${group.icon} ${group.name}`) + c.dim(` (${formatCount(fileCount, 'file')})`);
    const fileLines = group.files.map((file) => {
      const name = basename(file.source) || file.source;
      const groupsLabel =
        file.groups.length > 0 ? c.dim(`  [${file.groups.join(', ')}]`) : '';
      return `  ${c.cyan(name)}${c.dim(' → ')}${c.dim(file.source)}${groupsLabel}`;
    });
    prompts.log.message([header, ...fileLines].join('\n'));
  }

  prompts.outro(`Total: ${formatCount(totalFiles, 'tracked item')}`);
};

const printPathsOnly = (groups: CategoryGroup[]): void => {
  for (const group of groups) {
    for (const file of group.files) {
      console.log(file.source);
    }
  }
};

const printJson = (groups: CategoryGroup[]): void => {
  const output = groups.reduce(
    (acc, group) => {
      acc[group.name] = group.files.map((f) => ({
        source: f.source,
        destination: f.destination,
        groups: f.groups,
      }));
      return acc;
    },
    {} as Record<string, { source: string; destination: string; groups: string[] }[]>
  );

  console.log(JSON.stringify(output, null, 2));
};

const runList = async (options: ListOptions): Promise<void> => {
  const tuckDir = getTuckDir();

  // Verify tuck is initialized
  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);

  const filterGroups = await resolveGroupFilter(tuckDir, options);
  let groups = await groupByCategory(tuckDir, filterGroups);

  if (options.category) {
    groups = groups.filter((g) => g.name === options.category);
  }

  if (options.json) {
    printJson(groups);
  } else if (options.paths) {
    printPathsOnly(groups);
  } else {
    printList(groups, {
      categoryFilter: options.category,
      filterGroups: filterGroups ?? undefined,
    });
  }
};

export const listCommand = new Command('list')
  .description('List all tracked files')
  .option('-c, --category <name>', 'Filter by category')
  .option('-g, --group <name>', 'Filter by host-group (repeatable)', collectGroup, [])
  .option('--paths', 'Show only paths')
  .option('--json', 'Output as JSON')
  .action(async (options: ListOptions) => {
    await runList(options);
  });
