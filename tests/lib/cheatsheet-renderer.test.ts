import { describe, it, expect } from 'vitest';
import { renderMarkdown, renderJson } from '../../src/lib/cheatsheet/renderer.js';
import type { CheatsheetResult } from '../../src/lib/cheatsheet/types.js';

const FIXED_DATE = new Date('2026-04-21T12:00:00.000Z');
const baseOpts = { generatedAt: FIXED_DATE, tuckVersion: '2.6.0' };

describe('renderMarkdown', () => {
  it('renders an empty-result message when totalEntries is 0', () => {
    const result: CheatsheetResult = { sections: [], totalEntries: 0, skippedParsers: ['tmux', 'zsh'] };
    const md = renderMarkdown(result, baseOpts);
    expect(md).toContain('# Dotfiles Cheatsheet');
    expect(md).toContain('No keybinds detected');
    expect(md).toContain('generated: 2026-04-21T12:00:00.000Z');
    expect(md).toContain('tuckVersion: 2.6.0');
    expect(md).toContain('totalEntries: 0');
  });

  it('renders a single-file section without a File column', () => {
    const result: CheatsheetResult = {
      totalEntries: 2,
      skippedParsers: [],
      sections: [
        {
          parserId: 'tmux',
          label: 'tmux',
          entries: [
            { keybind: 'Prefix + r', action: 'reload config', sourceFile: '~/.tmux.conf', sourceLine: 3 },
            { keybind: 'Prefix + |', action: 'split vertical', sourceFile: '~/.tmux.conf', sourceLine: 5 },
          ],
        },
      ],
    };
    const md = renderMarkdown(result, baseOpts);
    expect(md).toContain('## tmux (~/.tmux.conf)');
    expect(md).toContain('| Keybind | Action |');
    // pipe in "Prefix + |" must be escaped so the cell doesn't split the row
    expect(md).toContain('`Prefix + \\|`');
    expect(md).not.toContain('| Keybind | Action | File |');
  });

  it('renders a multi-file section with a File column', () => {
    const result: CheatsheetResult = {
      totalEntries: 2,
      skippedParsers: [],
      sections: [
        {
          parserId: 'zsh',
          label: 'zsh',
          entries: [
            { keybind: '^R', action: 'history-search', sourceFile: '~/.zshrc', sourceLine: 12 },
            { keybind: 'll', action: 'ls -la', sourceFile: '~/.config/zsh/aliases.zsh', sourceLine: 4, category: 'alias' },
          ],
        },
      ],
    };
    const md = renderMarkdown(result, baseOpts);
    expect(md).toContain('## zsh');
    expect(md).toContain('| Keybind | Action | File |');
    expect(md).toContain('`~/.zshrc:12`');
    expect(md).toContain('`~/.config/zsh/aliases.zsh:4`');
  });

  it('escapes pipes + backticks inside cells to preserve table shape', () => {
    const result: CheatsheetResult = {
      totalEntries: 1,
      skippedParsers: [],
      sections: [
        {
          parserId: 'zsh',
          label: 'zsh',
          entries: [
            {
              keybind: 'weird',
              action: 'echo `date` | tee /tmp/log',
              sourceFile: '~/.zshrc',
              sourceLine: 1,
            },
          ],
        },
      ],
    };
    const md = renderMarkdown(result, baseOpts);
    expect(md).toContain('\\|');
    expect(md).not.toContain("`date`"); // backticks surrogated to single-quotes
  });

  it('uses the summary line to report entry + section counts', () => {
    const result: CheatsheetResult = {
      totalEntries: 2,
      skippedParsers: [],
      sections: [
        { parserId: 'a', label: 'a', entries: [{ keybind: '1', action: 'x', sourceFile: 'a', sourceLine: 1 }] },
        { parserId: 'b', label: 'b', entries: [{ keybind: '2', action: 'x', sourceFile: 'b', sourceLine: 1 }] },
      ],
    };
    const md = renderMarkdown(result, baseOpts);
    expect(md).toMatch(/2 entries across 2 sources/);
  });
});

describe('renderJson', () => {
  it('emits a flat entries array with parserId attached to each row', () => {
    const result: CheatsheetResult = {
      totalEntries: 3,
      skippedParsers: ['yazi'],
      sections: [
        {
          parserId: 'tmux',
          label: 'tmux',
          entries: [
            { keybind: 'Prefix + r', action: 'reload', sourceFile: '~/.tmux.conf', sourceLine: 3 },
          ],
        },
        {
          parserId: 'zsh',
          label: 'zsh',
          entries: [
            { keybind: '^R', action: 'history-search', sourceFile: '~/.zshrc', sourceLine: 12 },
            { keybind: 'll', action: 'ls -la', sourceFile: '~/.config/zsh/aliases.zsh', sourceLine: 4, category: 'alias', section: 'Listing' },
          ],
        },
      ],
    };
    const out = renderJson(result, baseOpts);
    const parsed = JSON.parse(out);

    expect(parsed.generated).toBe('2026-04-21T12:00:00.000Z');
    expect(parsed.tuckVersion).toBe('2.6.0');
    expect(parsed.totalEntries).toBe(3);
    expect(parsed.skippedParsers).toEqual(['yazi']);

    expect(parsed.entries).toHaveLength(3);
    expect(parsed.entries[0]).toEqual({
      parserId: 'tmux',
      keybind: 'Prefix + r',
      action: 'reload',
      sourceFile: '~/.tmux.conf',
      sourceLine: 3,
      category: null,
      section: null,
    });
    expect(parsed.entries[2]).toEqual({
      parserId: 'zsh',
      keybind: 'll',
      action: 'ls -la',
      sourceFile: '~/.config/zsh/aliases.zsh',
      sourceLine: 4,
      category: 'alias',
      section: 'Listing',
    });

    expect(parsed.sections).toEqual([
      { parserId: 'tmux', label: 'tmux', entryCount: 1 },
      { parserId: 'zsh', label: 'zsh', entryCount: 2 },
    ]);
  });

  it('emits explicit null for missing category/section so jq select(.x == null) works', () => {
    const result: CheatsheetResult = {
      totalEntries: 1,
      skippedParsers: [],
      sections: [
        {
          parserId: 'zsh',
          label: 'zsh',
          entries: [{ keybind: '^A', action: 'beginning-of-line', sourceFile: '~/.zshrc', sourceLine: 7 }],
        },
      ],
    };
    const out = renderJson(result, baseOpts);
    expect(out).toContain('"category": null');
    expect(out).toContain('"section": null');
  });

  it('emits a valid empty-state payload when totalEntries is 0', () => {
    const result: CheatsheetResult = { sections: [], totalEntries: 0, skippedParsers: ['tmux', 'zsh'] };
    const parsed = JSON.parse(renderJson(result, baseOpts));

    expect(parsed.totalEntries).toBe(0);
    expect(parsed.entries).toEqual([]);
    expect(parsed.sections).toEqual([]);
    expect(parsed.skippedParsers).toEqual(['tmux', 'zsh']);
  });

  it('ends with a trailing newline', () => {
    const result: CheatsheetResult = { sections: [], totalEntries: 0, skippedParsers: [] };
    expect(renderJson(result, baseOpts).endsWith('\n')).toBe(true);
  });
});

// TASK-065: `--no-timestamp` mode lets users commit the cheatsheet without
// every regen producing a 1-line `+/- generated:` diff. The renderer omits
// the field entirely (not nullified) when `includeTimestamp` is false.
describe('renderMarkdown with includeTimestamp=false', () => {
  const noStampOpts = { ...baseOpts, includeTimestamp: false };

  it('omits the generated frontmatter line when entries exist', () => {
    const result: CheatsheetResult = {
      totalEntries: 1,
      skippedParsers: [],
      sections: [
        {
          parserId: 'tmux',
          label: 'tmux',
          entries: [
            { keybind: 'Prefix + r', action: 'reload', sourceFile: '~/.tmux.conf', sourceLine: 3 },
          ],
        },
      ],
    };
    const md = renderMarkdown(result, noStampOpts);
    expect(md).not.toContain('generated:');
    expect(md).not.toContain('2026-04-21'); // no date sneaking through the summary line either
    expect(md).toContain('tuckVersion: 2.6.0'); // other frontmatter still present
  });

  it('omits the generated line in the empty-result frontmatter too', () => {
    const result: CheatsheetResult = { sections: [], totalEntries: 0, skippedParsers: ['tmux'] };
    const md = renderMarkdown(result, noStampOpts);
    expect(md).not.toContain('generated:');
    expect(md).toContain('tuckVersion: 2.6.0');
    expect(md).toContain('totalEntries: 0');
  });

  it('default (no flag) still emits the timestamp — regression guard', () => {
    const result: CheatsheetResult = { sections: [], totalEntries: 0, skippedParsers: [] };
    const md = renderMarkdown(result, baseOpts);
    expect(md).toContain('generated: 2026-04-21T12:00:00.000Z');
  });
});

describe('renderJson with includeTimestamp=false', () => {
  const noStampOpts = { ...baseOpts, includeTimestamp: false };

  it('omits the generated key entirely (not null) from the payload', () => {
    const result: CheatsheetResult = {
      totalEntries: 1,
      skippedParsers: [],
      sections: [
        {
          parserId: 'tmux',
          label: 'tmux',
          entries: [
            { keybind: 'Prefix + r', action: 'reload', sourceFile: '~/.tmux.conf', sourceLine: 3 },
          ],
        },
      ],
    };
    const parsed = JSON.parse(renderJson(result, noStampOpts));
    // Field is *omitted*, not nullified — `'generated' in parsed` must be false.
    expect('generated' in parsed).toBe(false);
    expect(parsed.tuckVersion).toBe('2.6.0');
    expect(parsed.totalEntries).toBe(1);
  });

  it('default (no flag) still emits the timestamp — regression guard', () => {
    const result: CheatsheetResult = { sections: [], totalEntries: 0, skippedParsers: [] };
    const parsed = JSON.parse(renderJson(result, baseOpts));
    expect(parsed.generated).toBe('2026-04-21T12:00:00.000Z');
  });
});
