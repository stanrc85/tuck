import { describe, it, expect } from 'vitest';
import { applyRules, type SourceMap } from '../../../src/lib/shellProfiler/rules.js';
import { parseXtrace } from '../../../src/lib/shellProfiler/parser.js';

const buildReport = (events: Array<{ file: string; line: number; command: string }>) => {
  const lines = events.map((e, i) => `+${1707000000 + i * 0.01}|${e.file}|${e.line}> ${e.command}`);
  // Add a tail event so every meaningful event gets a delta attributed.
  lines.push(`+${1707000000 + events.length * 0.01}|end.zsh|1> exit`);
  return parseXtrace(lines.join('\n'));
};

describe('applyRules', () => {
  it('returns no recommendations for a clean profile', () => {
    const report = buildReport([
      { file: '.zshrc', line: 1, command: 'alias ll="ls -la"' },
      { file: '.zshrc', line: 2, command: 'export EDITOR=nvim' },
    ]);
    expect(applyRules(report, {})).toEqual([]);
  });

  it('flags multiple compinit calls', () => {
    const report = buildReport([
      { file: '.zshrc', line: 5, command: 'autoload -Uz compinit' },
      { file: '.zshrc', line: 6, command: 'compinit' },
      { file: '/etc/zsh/zshrc', line: 1, command: 'compinit' },
    ]);
    const recs = applyRules(report, {});
    const rule = recs.find((r) => r.rule === 'multiple-compinit');
    expect(rule).toBeDefined();
    expect(rule!.severity).toBe('warn');
    expect(rule!.suggestion).toContain('skip_global_compinit');
  });

  it('flags duplicate PATH segments across sources', () => {
    const sources: SourceMap = {
      '.zshenv': 'export PATH="/usr/local/bin:/usr/bin"\n',
      '.zshrc': 'export PATH="/usr/local/bin:/opt/homebrew/bin"\n',
    };
    const recs = applyRules(buildReport([]), sources);
    const rule = recs.find((r) => r.rule === 'duplicate-path');
    expect(rule).toBeDefined();
    expect(rule!.evidence.join(' ')).toContain('/usr/local/bin');
  });

  it('does not false-positive on single PATH export with no duplicates', () => {
    const sources: SourceMap = {
      '.zshrc': 'export PATH="/usr/local/bin:/usr/bin"\n',
    };
    const recs = applyRules(buildReport([]), sources);
    expect(recs.find((r) => r.rule === 'duplicate-path')).toBeUndefined();
  });

  it('flags synchronous nvm/rbenv/pyenv initialization', () => {
    const report = buildReport([
      { file: '.zshrc', line: 10, command: 'source ~/.nvm/nvm.sh' },
      { file: '.zshrc', line: 11, command: 'eval "$(rbenv init -)"' },
    ]);
    const recs = applyRules(report, {});
    const rule = recs.find((r) => r.rule === 'sync-version-managers');
    expect(rule).toBeDefined();
    expect(rule!.message).toContain('nvm');
    expect(rule!.message).toContain('rbenv');
  });

  it('flags blocking network commands at startup', () => {
    const report = buildReport([
      { file: '.zshrc', line: 20, command: 'curl https://example.com/update' },
    ]);
    const recs = applyRules(report, {});
    const rule = recs.find((r) => r.rule === 'blocking-startup');
    expect(rule).toBeDefined();
    expect(rule!.severity).toBe('warn');
  });
});
