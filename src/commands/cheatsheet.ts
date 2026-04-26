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
import { renderMarkdown, renderJson } from '../lib/cheatsheet/renderer.js';
import { VERSION } from '../constants.js';

export type CheatsheetFormat = 'md' | 'json';

const KNOWN_FORMATS: readonly CheatsheetFormat[] = ['md', 'json'] as const;

export interface CheatsheetOptions {
  /** Output path. Defaults to `<tuckDir>/cheatsheet.<ext>` where ext matches --format. */
  output?: string;
  /** Print to stdout instead of writing a file. Takes precedence over --output. */
  stdout?: boolean;
  /** Comma/space-separated parser ids to include. Defaults to all registered. */
  sources?: string;
  /** Host-group filter — repeatable. Falls back to `config.defaultGroups`. */
  group?: string[];
  /** Output format. Defaults to `md`. */
  format?: string;
  /**
   * Whether to include the wall-clock `generated` timestamp in the output.
   * Commander populates this from the `--no-timestamp` flag: defaults to
   * `true`; passing `--no-timestamp` sets it to `false`. Disable when the
   * cheatsheet is committed and regenerated automatically — otherwise every
   * regen produces a 1-line `+/- generated:` diff.
   */
  timestamp?: boolean;
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

  const format: CheatsheetFormat = (options.format ?? 'md') as CheatsheetFormat;
  if (!KNOWN_FORMATS.includes(format)) {
    throw new Error(
      `Unknown --format value: ${options.format}. Known formats: ${KNOWN_FORMATS.join(', ')}`
    );
  }

  const filterGroups = await resolveGroupFilter(tuckDir, {
    group: options.group ?? [],
  });

  const result = await generateCheatsheet(tuckDir, {
    filterGroups,
    sources,
  });

  const includeTimestamp = options.timestamp !== false;
  const rendered = format === 'json'
    ? renderJson(result, { tuckVersion: VERSION, includeTimestamp })
    : renderMarkdown(result, { tuckVersion: VERSION, includeTimestamp });

  if (options.stdout) {
    process.stdout.write(rendered);
    if (!rendered.endsWith('\n')) process.stdout.write('\n');
    return { path: null, bytesWritten: Buffer.byteLength(rendered, 'utf-8'), totalEntries: result.totalEntries };
  }

  const defaultFilename = format === 'json' ? 'cheatsheet.json' : 'cheatsheet.md';
  const outputPath = options.output ?? join(tuckDir, defaultFilename);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, rendered, 'utf-8');

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
    bytesWritten: Buffer.byteLength(rendered, 'utf-8'),
    totalEntries: result.totalEntries,
  };
};

export const cheatsheetCommand = new Command('cheatsheet')
  .description('Generate a cheatsheet of keybinds/aliases from tracked dotfiles')
  .option(
    '-o, --output <path>',
    'Write the cheatsheet to this path (default: <tuckDir>/cheatsheet.<ext>)'
  )
  .option('--stdout', 'Print to stdout instead of writing a file')
  .option(
    '--sources <ids>',
    'Comma-separated parser ids to include (default: every registered parser)'
  )
  .option('-g, --group <name>', 'Filter tracked files by host-group (repeatable)', collectGroup, [])
  .option(
    '--format <md|json>',
    'Output format: md (GitHub-flavored markdown) or json (flat entries for jq/fzf)',
    'md'
  )
  .option(
    '--no-timestamp',
    'Omit the wall-clock generated timestamp (avoids noisy diffs when the cheatsheet is auto-regenerated)'
  )
  .action(async (options: CheatsheetOptions) => {
    await runCheatsheet(options);
  });
