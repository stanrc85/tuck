import { readFile } from 'fs/promises';
import { expandPath, collapsePath, pathExists, isDirectory } from '../paths.js';
import { getAllTrackedFiles } from '../manifest.js';
import { isIgnored } from '../tuckignore.js';
import { isBinaryExecutable } from '../binary.js';
import { getDirectoryFiles } from '../files.js';
import { FileNotFoundError } from '../../errors.js';
import { validateFile, hasErrors, type ValidationResult } from './index.js';

export interface ValidationTarget {
  absolutePath: string;
  displayPath: string;
}

// Resolve a (possibly empty) list of user-supplied paths to a flat list of
// absolute + display paths. Empty list means "every tracked file." Tracked
// directories expand to their contents so a tracked `~/.config/nvim` runs
// against every file inside, mirroring `tuck diff`.
export const collectValidationTargets = async (
  tuckDir: string,
  paths: string[],
): Promise<ValidationTarget[]> => {
  const allFiles = await getAllTrackedFiles(tuckDir);

  const trackedEntries =
    paths.length === 0
      ? Object.values(allFiles)
      : paths.map((p) => {
          const expanded = expandPath(p);
          const collapsed = collapsePath(expanded);
          const found = Object.values(allFiles).find((f) => f.source === collapsed);
          if (!found) throw new FileNotFoundError(`Not tracked: ${p}`);
          return found;
        });

  const targets: ValidationTarget[] = [];

  for (const entry of trackedEntries) {
    if (await isIgnored(tuckDir, entry.source)) continue;
    const absolute = expandPath(entry.source);
    if (!(await pathExists(absolute))) continue;

    if (await isDirectory(absolute)) {
      const files = await getDirectoryFiles(absolute);
      for (const f of files) {
        targets.push({ absolutePath: f, displayPath: collapsePath(f) });
      }
    } else {
      targets.push({ absolutePath: absolute, displayPath: entry.source });
    }
  }

  // De-dupe by absolute path — nested tracked entries (e.g. `~/.config` and
  // `~/.config/nvim`) would otherwise visit overlapping files twice.
  const seen = new Set<string>();
  return targets.filter((t) => {
    if (seen.has(t.absolutePath)) return false;
    seen.add(t.absolutePath);
    return true;
  });
};

// Run validateFile against every target, skipping binaries and unreadable
// files (read errors are deliberately swallowed — sync's own error path
// will surface them; here we just want a clean validation summary).
export const runValidationSweep = async (
  targets: ValidationTarget[],
): Promise<ValidationResult[]> => {
  const results: ValidationResult[] = [];
  for (const t of targets) {
    if (await isBinaryExecutable(t.absolutePath)) continue;
    let content: string;
    try {
      content = await readFile(t.absolutePath, 'utf-8');
    } catch {
      continue;
    }
    results.push(await validateFile(t.absolutePath, t.displayPath, content));
  }
  return results;
};

// Convenience for callers that only need to know "did this fail?" — folds
// the collect + sweep + filter into a single call. Returns just the failing
// results so the caller can render them inline.
export const validateTrackedFilesForGate = async (
  tuckDir: string,
): Promise<ValidationResult[]> => {
  const targets = await collectValidationTargets(tuckDir, []);
  const results = await runValidationSweep(targets);
  return results.filter((r) => hasErrors(r));
};
