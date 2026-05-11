/**
 * Pins the wiki pages to the generators. If schema or commander metadata
 * changes and `pnpm docs:gen` isn't run, these tests fail with a clear diff
 * pointing to what's out of sync.
 *
 * Bypasses the global memfs mock — we need to read the real wiki pages,
 * not the virtual filesystem.
 */

import { describe, it, expect, vi } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.unmock('fs');
vi.unmock('fs/promises');

const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs');
const { generateConfigDocs, generateCommandDocs } = await import('../../scripts/generate-docs.ts');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const configPath = join(repoRoot, 'docs/wiki/Configuration-Reference.md');
const commandPath = join(repoRoot, 'docs/wiki/Command-Reference.md');

describe('docs-gen — Configuration-Reference.md', () => {
  it('is in sync with the zod schema (run `pnpm docs:gen` if this fails)', () => {
    const current = readFileSync(configPath, 'utf8');
    const regenerated = generateConfigDocs(current);
    expect(regenerated).toBe(current);
  });

  it('throws when a marker block is missing', () => {
    const broken = '# Config\n\n(no markers here)\n';
    expect(() => generateConfigDocs(broken)).toThrow(/Missing marker block/);
  });

  it('detects stale config marker blocks', () => {
    const current = readFileSync(configPath, 'utf8');
    const withStale = current.replace(
      '## See also',
      '<!-- TUCK_GEN:start config.bogus -->\n<!-- TUCK_GEN:end config.bogus -->\n\n## See also'
    );
    expect(() => generateConfigDocs(withStale)).toThrow(/Stale marker block/);
  });
});

describe('docs-gen — Command-Reference.md', () => {
  it('is in sync with commander programs (run `pnpm docs:gen` if this fails)', () => {
    const current = readFileSync(commandPath, 'utf8');
    const regenerated = generateCommandDocs(current);
    expect(regenerated).toBe(current);
  });

  it('throws when a marker block is missing', () => {
    const broken = '# Commands\n\n(no markers)\n';
    expect(() => generateCommandDocs(broken)).toThrow(/Missing marker block/);
  });

  it('detects stale command marker blocks', () => {
    const current = readFileSync(commandPath, 'utf8');
    const withStale = current.replace(
      '## Secrets',
      '<!-- TUCK_GEN:start cmd.bogus -->\n<!-- TUCK_GEN:end cmd.bogus -->\n\n## Secrets'
    );
    expect(() => generateCommandDocs(withStale)).toThrow(/Stale marker block/);
  });
});
