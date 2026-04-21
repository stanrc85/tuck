import { Command } from 'commander';
import { writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { prompts, logger } from '../ui/index.js';
import { c } from '../ui/theme.js';
import { getTuckDir, collapsePath } from '../lib/paths.js';
import { resolveGroupFilter } from '../lib/groupFilter.js';
import {
  generateCheatsheet,
  getParserIds,
} from '../lib/cheatsheet/index.js';
import { renderMarkdown } from '../lib/cheatsheet/renderer.js';
import { VERSION } from '../constants.js';

export interface CheatsheetOptions {
  /** Output path. Defaults to `<tuckDir>/cheatsheet.md`. */
  output?: string;
  /** Print to stdout instead of writing a file. Takes precedence over --output. */
  stdout?: boolean;
  /** Comma/space-separated parser ids to include. Defaults to all registered. */
  sources?: string;
  /** Host-group filter — repeatable. Falls back to `config.defaultGroups`. */
  group?: string[];
}

const collectGroup = (value: string, previous: string[] = []): string[] => [
  ...previous,
  ...value
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean),
];

const parseSourcesList = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

export const runCheatsheet = async (
  options: CheatsheetOptions = {}
): Promise<{ path: string | null; bytesWritten: number; totalEntries: number }> => {
  const tuckDir = getTuckDir();
  const sources = parseSourcesList(options.sources);

  if (sources.length > 0) {
    const known = new Set(getParserIds());
    const unknown = sources.filter((s) => !known.has(s));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown --sources value${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. ` +
          `Known parsers: ${[...known].join(', ')}`
      );
    }
  }

  const filterGroups = await resolveGroupFilter(tuckDir, {
    group: options.group ?? [],
  });

  const result = await generateCheatsheet(tuckDir, {
    filterGroups,
    sources,
  });

  const markdown = renderMarkdown(result, { tuckVersion: VERSION });

  if (options.stdout) {
    process.stdout.write(markdown);
    if (!markdown.endsWith('\n')) process.stdout.write('\n');
    return { path: null, bytesWritten: Buffer.byteLength(markdown, 'utf-8'), totalEntries: result.totalEntries };
  }

  const outputPath = options.output ?? join(tuckDir, 'cheatsheet.md');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, 'utf-8');

  prompts.intro('tuck cheatsheet');
  if (result.totalEntries === 0) {
    logger.warning('No keybinds detected in tracked files.');
    logger.info(
      `Supported sources: ${getParserIds().join(', ')}. Cheatsheet still written (empty).`
    );
  } else {
    logger.success(
      `Wrote ${result.totalEntries} entr${result.totalEntries === 1 ? 'y' : 'ies'} across ${result.sections.length} source${result.sections.length === 1 ? '' : 's'}`
    );
    for (const section of result.sections) {
      console.log(
        c.dim(`  • ${section.label}: ${section.entries.length} entr${section.entries.length === 1 ? 'y' : 'ies'}`)
      );
    }
  }
  logger.info(`→ ${collapsePath(outputPath)}`);
  prompts.outro('');

  return {
    path: outputPath,
    bytesWritten: Buffer.byteLength(markdown, 'utf-8'),
    totalEntries: result.totalEntries,
  };
};

export const cheatsheetCommand = new Command('cheatsheet')
  .description('Generate a markdown cheatsheet of keybinds/aliases from tracked dotfiles')
  .option(
    '-o, --output <path>',
    'Write the cheatsheet to this path (default: <tuckDir>/cheatsheet.md)'
  )
  .option('--stdout', 'Print to stdout instead of writing a file')
  .option(
    '--sources <ids>',
    'Comma-separated parser ids to include (default: every registered parser)'
  )
  .option('-g, --group <name>', 'Filter tracked files by host-group (repeatable)', collectGroup, [])
  .action(async (options: CheatsheetOptions) => {
    await runCheatsheet(options);
  });
