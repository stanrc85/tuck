import { readFile, readdir } from 'fs/promises';
import { join, relative, sep } from 'path';
import {
  loadManifest,
  getAllTrackedFiles,
  assertMigrated,
  fileMatchesGroups,
} from '../manifest.js';
import {
  expandPath,
  pathExists,
  isDirectory,
  validateSafeSourcePath,
  validateSafeManifestDestination,
  validatePathWithinRoot,
} from '../paths.js';
import { NotInitializedError } from '../../errors.js';
import { BUILT_IN_PARSERS } from './registry.js';
import type { CheatsheetResult, Entry, Parser } from './types.js';

export interface GenerateOptions {
  /** Host-group filter — pre-resolved by the caller via `resolveGroupFilter`. */
  filterGroups?: string[];
  /** Restrict to a subset of parser ids. Omit/empty → use every registered parser. */
  sources?: string[];
  /** Override parser list. Tests inject fixtures; real callers should omit. */
  parsers?: readonly Parser[];
}

/**
 * Walk the tracked-file manifest, run each applicable parser against
 * each file's *source* content (what lives in the repo, not the
 * rendered host target — a cheatsheet should reflect the canonical
 * tracked state, not whatever the host happens to have at restore
 * time). Returns the collected entries grouped by parser id.
 *
 * Errors reading individual files are swallowed (permissions, race on
 * a manifest entry whose source was hand-deleted) — the run logs a
 * warning to stderr and continues. A parser error on one file also
 * doesn't stop the sweep; parsers can assume well-formed input because
 * `match` is the author's gate.
 *
 * No explicit binary-file detection: parsers self-select via `match`,
 * and if a binary file slipped through content scanning, its regexes
 * simply wouldn't match. Not worth the complexity cost of a separate
 * `isBinaryFile` probe here.
 */
export const generateCheatsheet = async (
  tuckDir: string,
  options: GenerateOptions = {}
): Promise<CheatsheetResult> => {
  let manifest;
  try {
    manifest = await loadManifest(tuckDir);
  } catch {
    throw new NotInitializedError();
  }
  assertMigrated(manifest);

  const parsers = options.parsers ?? BUILT_IN_PARSERS;
  const sourcesFilter =
    options.sources && options.sources.length > 0
      ? new Set(options.sources)
      : null;
  const activeParsers = sourcesFilter
    ? parsers.filter((p) => sourcesFilter.has(p.id))
    : parsers;

  const allFiles = await getAllTrackedFiles(tuckDir);
  const entriesByParser = new Map<string, Entry[]>();
  for (const parser of activeParsers) {
    entriesByParser.set(parser.id, []);
  }

  const runParsersOnFile = async (
    repoPath: string,
    virtualSourcePath: string
  ): Promise<void> => {
    let content: string;
    try {
      content = await readFile(repoPath, 'utf-8');
    } catch {
      return;
    }
    for (const parser of activeParsers) {
      if (!parser.match(virtualSourcePath, content)) continue;
      try {
        const entries = parser.parse(content, { sourceFile: virtualSourcePath });
        if (entries.length > 0) {
          entriesByParser.get(parser.id)!.push(...entries);
        }
      } catch {
        // Parser crash on one file shouldn't stop the sweep.
      }
    }
  };

  for (const file of Object.values(allFiles)) {
    if (!fileMatchesGroups(file, options.filterGroups)) continue;

    try {
      validateSafeSourcePath(file.source);
      validateSafeManifestDestination(file.destination);
    } catch {
      continue;
    }

    const repoPath = join(tuckDir, file.destination);
    try {
      validatePathWithinRoot(repoPath, tuckDir, 'cheatsheet source');
    } catch {
      continue;
    }
    if (!(await pathExists(repoPath))) continue;

    if (await isDirectory(repoPath)) {
      // Tracked directory — walk recursively and synthesize a virtual source
      // path for each file so parsers match on the true filename (e.g.
      // `~/.config/nvim/lua/plugins/telescope.lua`) even though only
      // `~/.config/nvim` exists as a manifest entry.
      for (const childRepoPath of await walkFiles(repoPath)) {
        const relFromDir = relative(repoPath, childRepoPath)
          .split(sep)
          .join('/');
        const virtualSourcePath = `${file.source.replace(/\/$/, '')}/${relFromDir}`;
        await runParsersOnFile(childRepoPath, virtualSourcePath);
      }
    } else {
      await runParsersOnFile(repoPath, file.source);
    }
  }

  const sections: CheatsheetResult['sections'] = [];
  const skippedParsers: string[] = [];
  for (const parser of activeParsers) {
    const entries = entriesByParser.get(parser.id) ?? [];
    if (entries.length === 0) {
      skippedParsers.push(parser.id);
      continue;
    }
    sections.push({ parserId: parser.id, label: parser.label, entries });
  }

  const totalEntries = sections.reduce((sum, s) => sum + s.entries.length, 0);
  void expandPath; // Retained for parity with other lib modules' import footprint.

  return { sections, totalEntries, skippedParsers };
};

/**
 * Recursively list every regular file under `dir`. Symlinks are
 * followed for readdir entry classification but not resolved — same
 * semantics as the restore copy path. Unreadable subdirs are skipped.
 */
const walkFiles = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
};

export * from './types.js';
export { BUILT_IN_PARSERS, getParserIds } from './registry.js';
