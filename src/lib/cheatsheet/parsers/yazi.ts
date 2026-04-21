import { parse as parseToml } from 'smol-toml';
import type { Entry, Parser, ParserContext } from '../types.js';

/**
 * Parse yazi's `keymap.toml`. Two schema generations coexist in the
 * wild because yazi switched from SemVer to CalVer in late 2024 and
 * reshuffled the config shape at the same time:
 *
 *   Newer (v25+/v26+, the CalVer era):
 *     [mgr]                            # also [manager], [input], [select], …
 *     keymap = [
 *         { on = "r", run = "reload", desc = "Reload" },
 *         { on = "<Esc>", run = "escape" },
 *     ]
 *     prepend_keymap = [ ... ]
 *
 *   Older (pre-CalVer):
 *     [[keymap.manager.prepend_keymap]]
 *     on  = ['r']
 *     run = 'reload'
 *     desc = 'Reload'
 *
 * Rather than hardcode either shape, we recursively walk the parsed
 * TOML looking for any key named `keymap` / `prepend_keymap` /
 * `append_keymap` whose value is an array of objects that have an
 * `on` field. The ancestor path yields the mode (`mgr`, `input`, …)
 * which becomes the Entry category.
 *
 * `on` may be a single key (`"r"` or `['r']`) or a sequence
 * (`['d', 'd']`). Multi-step sequences render with ` then ` between
 * steps so the chord is visible in the cheatsheet.
 *
 * Errors (malformed TOML, unexpected shapes) are swallowed with an
 * empty-result return — the parser is a best-effort pass, not a linter.
 */

interface YaziEntryRaw {
  on?: unknown;
  run?: unknown;
  desc?: unknown;
}

const KEYMAP_KEYS = new Set(['keymap', 'prepend_keymap', 'append_keymap']);

const formatKey = (on: unknown): string | null => {
  if (typeof on === 'string') return on;
  if (!Array.isArray(on)) return null;
  const keys = on.filter((k): k is string => typeof k === 'string');
  if (keys.length === 0) return null;
  return keys.length === 1 ? keys[0] : keys.join(' then ');
};

/** True iff `value` is an array of plain objects, each with an `on` field. */
const looksLikeKeymapArray = (value: unknown): boolean => {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (v) => typeof v === 'object' && v !== null && 'on' in (v as object)
  );
};

const collectFromArray = (
  value: unknown[],
  mode: string | undefined,
  ctx: ParserContext,
  entries: Entry[]
): void => {
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as YaziEntryRaw;
    const key = formatKey(entry.on);
    if (!key) continue;
    const run = typeof entry.run === 'string' ? entry.run : '';
    const desc = typeof entry.desc === 'string' ? entry.desc : '';
    entries.push({
      keybind: key,
      action: desc.length > 0 ? desc : run,
      sourceFile: ctx.sourceFile,
      // smol-toml doesn't surface source line numbers after parsing
      // structured data; 0 is the "unknown line" sentinel.
      sourceLine: 0,
      category: mode,
    });
  }
};

/**
 * Recursively hunt for keymap-shaped arrays in the parsed TOML. When
 * we find one, `modeHint` is the nearest enclosing table key (newer
 * shape: `mgr`, `input`, …; older shape: `manager`, `input`, … nested
 * under `keymap`). For the nested-under-`keymap` case, walking drops
 * the `keymap` prefix so both shapes produce the same Entry.category.
 */
const walk = (
  node: unknown,
  modeHint: string | undefined,
  ctx: ParserContext,
  entries: Entry[]
): void => {
  if (typeof node !== 'object' || node === null) return;
  if (Array.isArray(node)) return;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (KEYMAP_KEYS.has(key) && looksLikeKeymapArray(value)) {
      collectFromArray(value as unknown[], modeHint, ctx, entries);
      continue;
    }
    // `keymap` is a known prefix in the older shape — don't let it
    // become a spurious mode name. Fall through into its children
    // carrying the PARENT's modeHint (which will be undefined at the
    // top level, and then the next recursion picks up `manager`,
    // `input`, etc. as the real mode).
    if (key === 'keymap') {
      walk(value, modeHint, ctx, entries);
    } else {
      walk(value, key, ctx, entries);
    }
  }
};

export const yaziParser: Parser = {
  id: 'yazi',
  label: 'yazi',
  match: (sourcePath: string) => {
    return (
      sourcePath.endsWith('/keymap.toml') ||
      sourcePath.endsWith('\\keymap.toml')
    ) && /[/\\]yazi[/\\]/.test(sourcePath);
  },
  parse: (content: string, ctx: ParserContext): Entry[] => {
    let parsed: Record<string, unknown>;
    try {
      parsed = parseToml(content) as Record<string, unknown>;
    } catch {
      return [];
    }

    const entries: Entry[] = [];
    walk(parsed, undefined, ctx, entries);
    return entries;
  },
};
