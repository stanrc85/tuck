import { parse as parseToml } from 'smol-toml';
import type { Entry, Parser, ParserContext } from '../types.js';

/**
 * Parse yazi's `keymap.toml`. Shape:
 *
 *   [[keymap.manager.prepend_keymap]]
 *   on  = ['r']
 *   run = 'reload'
 *   desc = 'Reload'
 *
 *   [[keymap.input.keymap]]
 *   on  = ['<Esc>']
 *   run = 'escape'
 *
 * Both `prepend_keymap` and `keymap` arrays are walked. Mode (`manager`,
 * `input`, etc.) is captured as the Entry category.
 *
 * `on` can be a single key (`['r']`) or a key sequence (`['d', 'd']`).
 * We join with ` then ` for multi-step sequences so the rendered
 * cheatsheet shows the full chord.
 *
 * Errors (malformed TOML, unexpected shapes) are swallowed with an
 * empty-result return — the parser is a best-effort pass, not a linter.
 */

interface YaziEntryRaw {
  on?: unknown;
  run?: unknown;
  desc?: unknown;
}

const formatKey = (on: unknown): string | null => {
  if (typeof on === 'string') return on;
  if (!Array.isArray(on)) return null;
  const keys = on.filter((k): k is string => typeof k === 'string');
  if (keys.length === 0) return null;
  return keys.join(' then ');
};

const collectFromArray = (
  value: unknown,
  mode: string,
  ctx: ParserContext,
  entries: Entry[]
): void => {
  if (!Array.isArray(value)) return;
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
    const keymap = (parsed.keymap ?? {}) as Record<string, unknown>;
    for (const [mode, modeValue] of Object.entries(keymap)) {
      if (typeof modeValue !== 'object' || modeValue === null) continue;
      const modeTable = modeValue as Record<string, unknown>;
      collectFromArray(modeTable.prepend_keymap, mode, ctx, entries);
      collectFromArray(modeTable.keymap, mode, ctx, entries);
      collectFromArray(modeTable.append_keymap, mode, ctx, entries);
    }
    return entries;
  },
};
