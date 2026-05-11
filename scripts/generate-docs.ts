/**
 * Regenerates the schema-derived and commander-derived parts of
 * `docs/wiki/Configuration-Reference.md` and `docs/wiki/Command-Reference.md`.
 *
 * The wiki pages mark machine-managed regions with HTML-comment markers:
 *   <!-- TUCK_GEN:start <id> -->
 *   ...generated content...
 *   <!-- TUCK_GEN:end <id> -->
 *
 * Everything outside the markers is hand-written and preserved verbatim.
 *
 * Run via `pnpm docs:gen`. CI runs the same script and fails if the wiki
 * pages diff against `git`, which is how schema/commander drift is caught.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, type ZodTypeAny } from 'zod';
import { Command } from 'commander';

import {
  tuckConfigSchema,
  tuckLocalConfigSchema,
  defaultConfig,
} from '../src/schemas/config.schema.ts';
import * as commands from '../src/commands/index.ts';

// ---------------------------------------------------------------------------
// Marker block replacement
// ---------------------------------------------------------------------------

const START_RE = /<!-- TUCK_GEN:start (?<id>[A-Za-z0-9._-]+) -->/g;
const blockRegex = (id: string): RegExp =>
  new RegExp(
    `<!-- TUCK_GEN:start ${escapeRegex(id)} -->[\\s\\S]*?<!-- TUCK_GEN:end ${escapeRegex(id)} -->`,
    'm'
  );

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceBlock(source: string, id: string, body: string): string {
  const re = blockRegex(id);
  if (!re.test(source)) {
    throw new Error(`Missing marker block for id="${id}"`);
  }
  const block = `<!-- TUCK_GEN:start ${id} -->\n${body.trimEnd()}\n<!-- TUCK_GEN:end ${id} -->`;
  return source.replace(re, block);
}

function collectMarkerIds(source: string): Set<string> {
  const ids = new Set<string>();
  for (const match of source.matchAll(START_RE)) {
    if (match.groups?.id) ids.add(match.groups.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Zod schema introspection
// ---------------------------------------------------------------------------

interface FieldInfo {
  name: string;
  type: string;
  defaultValue: unknown;
  hasDefault: boolean;
  isOptional: boolean;
  description: string | undefined;
  /** Inner schema for nested objects, used to emit a subfield table */
  objectShape: Record<string, ZodTypeAny> | undefined;
}

function unwrap(schema: ZodTypeAny): {
  inner: ZodTypeAny;
  defaultValue: unknown;
  hasDefault: boolean;
  isOptional: boolean;
  description: string | undefined;
} {
  let inner: ZodTypeAny = schema;
  let defaultValue: unknown = undefined;
  let hasDefault = false;
  let isOptional = false;
  let description: string | undefined = schema.description;

  // Peel ZodDefault / ZodOptional repeatedly. Capture description from any
  // layer that has it set (the outermost .describe() wins).
  while (true) {
    if (!description && inner.description) description = inner.description;
    if (inner instanceof z.ZodDefault) {
      hasDefault = true;
      const def = inner._def.defaultValue;
      defaultValue = typeof def === 'function' ? def() : def;
      inner = inner._def.innerType;
    } else if (inner instanceof z.ZodOptional) {
      isOptional = true;
      inner = inner._def.innerType;
    } else if (inner instanceof z.ZodNullable) {
      inner = inner._def.innerType;
    } else {
      break;
    }
  }
  if (!description && inner.description) description = inner.description;
  return { inner, defaultValue, hasDefault, isOptional, description };
}

function typeLabel(schema: ZodTypeAny): string {
  const { inner } = unwrap(schema);
  if (inner instanceof z.ZodString) return '`string`';
  if (inner instanceof z.ZodNumber) return '`number`';
  if (inner instanceof z.ZodBoolean) return '`boolean`';
  if (inner instanceof z.ZodEnum) {
    return (inner._def.values as string[]).map((v) => `\`"${v}"\``).join(' \\| ');
  }
  if (inner instanceof z.ZodArray) {
    const elem = typeLabel(inner._def.type).replace(/^`|`$/g, '');
    return `\`${elem}[]\``;
  }
  if (inner instanceof z.ZodRecord) {
    const value = typeLabel(inner._def.valueType).replace(/^`|`$/g, '');
    return `\`Record<string, ${value}>\``;
  }
  if (inner instanceof z.ZodObject) return '`object`';
  return '`unknown`';
}

function formatDefault(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return '`null`';
  if (typeof value === 'string') return `\`"${value}"\``;
  if (typeof value === 'number' || typeof value === 'boolean') return `\`${value}\``;
  if (Array.isArray(value)) {
    if (value.length === 0) return '`[]`';
    return `\`${JSON.stringify(value)}\``;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '`{}`';
    return `\`${JSON.stringify(value)}\``;
  }
  return '—';
}

function describeField(name: string, schema: ZodTypeAny): FieldInfo {
  const { inner, defaultValue, hasDefault, isOptional, description } = unwrap(schema);
  const objectShape = inner instanceof z.ZodObject ? (inner.shape as Record<string, ZodTypeAny>) : undefined;
  return {
    name,
    type: typeLabel(schema),
    defaultValue,
    hasDefault,
    isOptional,
    description,
    objectShape,
  };
}

// ---------------------------------------------------------------------------
// Markdown emission — config schema
// ---------------------------------------------------------------------------

const CONFIG_FIELD_ORDER = [
  'repository',
  'files',
  'defaultGroups',
  'readOnlyGroups',
  'snapshots',
  'hooks',
  'validation',
  'ignore',
  'categories',
  'ui',
  'remote',
  'security',
  'encryption',
];

function renderJsonExample(name: string, value: unknown): string {
  const sample = { [name]: value };
  return ['```json', JSON.stringify(sample, null, 2), '```'].join('\n');
}

function renderSubfieldTable(shape: Record<string, ZodTypeAny>): string {
  const rows = Object.entries(shape)
    .filter(([subname]) => !subname.startsWith('_'))
    .map(([subname, subschema]) => {
      const info = describeField(subname, subschema);
      const def = info.hasDefault ? formatDefault(info.defaultValue) : '—';
      const desc = info.description ?? '';
      return `| \`${subname}\` | ${info.type} | ${def} | ${desc} |`;
    });
  return ['| Field | Type | Default | Description |', '|-------|------|---------|-------------|', ...rows].join(
    '\n'
  );
}

function renderConfigField(name: string, schema: ZodTypeAny, exampleValue: unknown): string {
  const info = describeField(name, schema);
  const lines: string[] = [];
  lines.push(renderJsonExample(name, exampleValue));
  lines.push('');
  if (info.objectShape && Object.keys(info.objectShape).length > 0) {
    lines.push(renderSubfieldTable(info.objectShape));
  } else {
    const defLabel = info.hasDefault ? formatDefault(info.defaultValue) : '—';
    lines.push(`**Type**: ${info.type}. **Default**: ${defLabel}.`);
  }
  if (info.description) {
    lines.push('');
    lines.push(info.description);
  }
  return lines.join('\n');
}

function renderLocalSchemaTable(): string {
  const shape = (tuckLocalConfigSchema as unknown as z.ZodObject<Record<string, ZodTypeAny>>).shape;
  const rows = Object.entries(shape).map(([subname, subschema]) => {
    const info = describeField(subname, subschema);
    const desc = info.description ?? '';
    return `| \`${subname}\` | ${info.type} | ${desc} |`;
  });
  return ['| Field | Type | Description |', '|-------|------|-------------|', ...rows].join('\n');
}

export function generateConfigDocs(page: string): string {
  const shape = (tuckConfigSchema as unknown as z.ZodObject<Record<string, ZodTypeAny>>).shape;
  const declared = new Set(Object.keys(shape));
  const ordered = new Set(CONFIG_FIELD_ORDER);

  for (const name of declared) {
    if (!ordered.has(name)) {
      throw new Error(
        `Schema has field "${name}" missing from CONFIG_FIELD_ORDER. Add it to scripts/generate-docs.ts.`
      );
    }
  }
  for (const name of ordered) {
    if (!declared.has(name)) {
      throw new Error(
        `CONFIG_FIELD_ORDER references "${name}" but it is not in tuckConfigSchema.`
      );
    }
  }

  let out = page;
  const expectedIds = new Set<string>();

  // Per-field blocks.
  for (const name of CONFIG_FIELD_ORDER) {
    const fieldSchema = shape[name];
    const id = `config.${name}`;
    expectedIds.add(id);
    const exampleValue = (defaultConfig as Record<string, unknown>)[name];
    const body = renderConfigField(name, fieldSchema, exampleValue);
    out = replaceBlock(out, id, body);
  }

  // Local-schema table.
  expectedIds.add('config.local');
  out = replaceBlock(out, 'config.local', renderLocalSchemaTable());

  // Sanity check: no stale ids left in the page.
  const presentIds = collectMarkerIds(out);
  for (const id of presentIds) {
    if (id.startsWith('config.') && !expectedIds.has(id)) {
      throw new Error(`Stale marker block in Configuration-Reference.md: "${id}"`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Markdown emission — commander
// ---------------------------------------------------------------------------

/**
 * Order matches the existing Command-Reference Contents block. Subcommands
 * (e.g. `tuck bootstrap update`) are addressed by their parent's id and
 * resolved at emission time.
 */
const COMMAND_ORDER: { id: string; commandPath: string[] }[] = [
  { id: 'init', commandPath: ['init'] },
  { id: 'sync', commandPath: ['sync'] },
  { id: 'status', commandPath: ['status'] },
  { id: 'add', commandPath: ['add'] },
  { id: 'remove', commandPath: ['remove'] },
  { id: 'scan', commandPath: ['scan'] },
  { id: 'list', commandPath: ['list'] },
  { id: 'diff', commandPath: ['diff'] },
  { id: 'ignore', commandPath: ['ignore'] },
  { id: 'group', commandPath: ['group'] },
  { id: 'migrate', commandPath: ['migrate'] },
  { id: 'clean', commandPath: ['clean'] },
  { id: 'push', commandPath: ['push'] },
  { id: 'pull', commandPath: ['pull'] },
  { id: 'apply', commandPath: ['apply'] },
  { id: 'restore', commandPath: ['restore'] },
  { id: 'undo', commandPath: ['undo'] },
  { id: 'cheatsheet', commandPath: ['cheatsheet'] },
  { id: 'config', commandPath: ['config'] },
  { id: 'doctor', commandPath: ['doctor'] },
  { id: 'validate', commandPath: ['validate'] },
  { id: 'optimize', commandPath: ['optimize'] },
  { id: 'self-update', commandPath: ['self-update'] },
  { id: 'bootstrap', commandPath: ['bootstrap'] },
  { id: 'bootstrap.update', commandPath: ['bootstrap', 'update'] },
  { id: 'bootstrap.bundle', commandPath: ['bootstrap', 'bundle'] },
  { id: 'update', commandPath: ['update'] },
  { id: 'secrets', commandPath: ['secrets'] },
];

const COMMAND_REGISTRY: Record<string, Command> = {
  init: commands.initCommand,
  sync: commands.syncCommand,
  status: commands.statusCommand,
  add: commands.addCommand,
  remove: commands.removeCommand,
  scan: commands.scanCommand,
  list: commands.listCommand,
  diff: commands.diffCommand,
  ignore: commands.ignoreCommand,
  group: commands.groupCommand,
  migrate: commands.migrateCommand,
  clean: commands.cleanCommand,
  push: commands.pushCommand,
  pull: commands.pullCommand,
  apply: commands.applyCommand,
  restore: commands.restoreCommand,
  undo: commands.undoCommand,
  cheatsheet: commands.cheatsheetCommand,
  config: commands.configCommand,
  doctor: commands.doctorCommand,
  validate: commands.validateCommand,
  optimize: commands.optimizeCommand,
  'self-update': commands.selfUpdateCommand,
  bootstrap: commands.bootstrapCommand,
  update: commands.updateCommand,
  secrets: commands.secretsCommand,
};

function resolveCommand(path: string[]): Command {
  const root = COMMAND_REGISTRY[path[0]];
  if (!root) throw new Error(`Unknown command "${path[0]}"`);
  let current = root;
  for (let i = 1; i < path.length; i++) {
    const child = current.commands.find((c) => c.name() === path[i]);
    if (!child) {
      throw new Error(`Subcommand "${path.slice(0, i + 1).join(' ')}" not registered`);
    }
    current = child;
  }
  return current;
}

function renderSynopsis(cmd: Command, displayName: string): string {
  const hasOptions = cmd.options.length > 0;
  const args = cmd.registeredArguments
    .map((a) => {
      const inner = a.variadic ? `${a.name()}...` : a.name();
      return a.required ? `<${inner}>` : `[${inner}]`;
    })
    .join(' ');
  const optsToken = hasOptions ? '[options]' : '';
  const parts = [`tuck ${displayName}`, args, optsToken].filter(Boolean).join(' ');
  return `    ${parts}`;
}

function renderOptions(cmd: Command): string {
  if (cmd.options.length === 0) return '';
  const lines = cmd.options.map((opt) => {
    const flags = opt.flags;
    const desc = opt.description ?? '';
    return `- \`${flags}\` — ${desc}`;
  });
  return ['**Options**', '', ...lines].join('\n');
}

function renderSubcommandList(cmd: Command, parentDisplay: string): string {
  if (cmd.commands.length === 0) return '';
  const lines = cmd.commands.map((sub) => {
    const subArgs = sub.registeredArguments
      .map((a) => {
        const inner = a.variadic ? `${a.name()}...` : a.name();
        return a.required ? `<${inner}>` : `[${inner}]`;
      })
      .join(' ');
    const synopsis = [`tuck ${parentDisplay} ${sub.name()}`, subArgs].filter(Boolean).join(' ');
    return `    ${synopsis}`;
  });
  return ['**Synopsis**', '', ...lines].join('\n');
}

function renderCommandBlock(entry: { id: string; commandPath: string[] }): string {
  const displayName = entry.commandPath.join(' ');
  const cmd = resolveCommand(entry.commandPath);
  const lines: string[] = [];

  // Router-style commands (`tuck bootstrap bundle list/show/…`) carry no
  // options on the parent — emit the subcommand synopses instead.
  if (cmd.commands.length > 0 && cmd.options.length === 0) {
    lines.push(renderSubcommandList(cmd, displayName));
  } else {
    lines.push('**Synopsis**');
    lines.push('');
    lines.push(renderSynopsis(cmd, displayName));
    const opts = renderOptions(cmd);
    if (opts) {
      lines.push('');
      lines.push(opts);
    }
  }
  return lines.join('\n').trimEnd();
}

export function generateCommandDocs(page: string): string {
  let out = page;
  const expectedIds = new Set<string>();
  for (const entry of COMMAND_ORDER) {
    const id = `cmd.${entry.id}`;
    expectedIds.add(id);
    const body = renderCommandBlock(entry);
    out = replaceBlock(out, id, body);
  }
  const presentIds = collectMarkerIds(out);
  for (const id of presentIds) {
    if (id.startsWith('cmd.') && !expectedIds.has(id)) {
      throw new Error(`Stale marker block in Command-Reference.md: "${id}"`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function rewriteFile(path: string, transform: (s: string) => string): boolean {
  // Normalize to LF on read so a Windows contributor whose autocrlf added \r
  // doesn't end up with mixed line endings after we splice LF-only generated
  // content into a CRLF-bodied file. .gitattributes pins these pages to LF
  // already, this is the belt-and-suspenders.
  const before = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const after = transform(before);
  if (before === after) return false;
  writeFileSync(path, after);
  return true;
}

function main(): void {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const configPath = join(repoRoot, 'docs/wiki/Configuration-Reference.md');
  const commandPath = join(repoRoot, 'docs/wiki/Command-Reference.md');

  const changedConfig = rewriteFile(configPath, generateConfigDocs);
  const changedCommand = rewriteFile(commandPath, generateCommandDocs);

  if (changedConfig) console.log(`[docs:gen] updated ${configPath}`);
  else console.log(`[docs:gen] ${configPath} already up to date`);
  if (changedCommand) console.log(`[docs:gen] updated ${commandPath}`);
  else console.log(`[docs:gen] ${commandPath} already up to date`);
}

// Only run the side-effecting main when executed directly (not when imported
// by a test). Compare normalized paths so a `tsx scripts/generate-docs.ts`
// invocation triggers the rewrite but `import` from a vitest test does not.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
