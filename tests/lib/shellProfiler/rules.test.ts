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

  it('does not count compinit function-body events as invocations', () => {
    // When compinit runs under xtrace, every line INSIDE compinit emits an
    // event with sourceFile='compinit'. Those are not invocations — they're
    // the single call unfurling line-by-line.
    const internals = Array.from({ length: 100 }, (_, i) => ({
      file: 'compinit',
      line: 100 + i,
      command: `: compinit internal line ${i}`,
    }));
    const report = buildReport([
      { file: '.zshrc', line: 10, command: 'compinit' },
      ...internals,
    ]);
    // Only 1 real call — rule should NOT fire.
    expect(applyRules(report, {}).find((r) => r.rule === 'multiple-compinit')).toBeUndefined();
  });

  it('does not count `autoload -Uz compinit` as an invocation', () => {
    // Autoload just marks the function as loadable — does not execute it.
    const report = buildReport([
      { file: '.zshrc', line: 5, command: 'autoload -Uz compinit' },
      { file: '.zshrc', line: 6, command: 'autoload -Uz compinit' },
    ]);
    expect(applyRules(report, {}).find((r) => r.rule === 'multiple-compinit')).toBeUndefined();
  });

  it('does not count `: compinit ...` no-op comments as invocations', () => {
    // zsh uses `: command args` as a no-op that leaves args in the trace for
    // debugging. compinit's internals are full of these.
    const report = buildReport([
      { file: '.zshrc', line: 5, command: ": compinit '(anon)' /etc/zsh/zshrc" },
      { file: '.zshrc', line: 6, command: ': compinit bar' },
    ]);
    expect(applyRules(report, {}).find((r) => r.rule === 'multiple-compinit')).toBeUndefined();
  });

  it('suppresses multiple-compinit when skip_global_compinit=1 is already set', () => {
    const report = buildReport([
      { file: '.zshrc', line: 6, command: 'compinit' },
      { file: '/etc/zsh/zshrc', line: 1, command: 'compinit' },
    ]);
    const sources = {
      '.zshenv': 'skip_global_compinit=1\nexport EDITOR=nvim\n',
    };
    expect(applyRules(report, sources).find((r) => r.rule === 'multiple-compinit')).toBeUndefined();
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

  it('does not false-positive on nvm events inside nvm.sh itself', () => {
    // Once the user sources nvm.sh, every line inside runs under sourceFile
    // matching nvm.sh / nvm/ — those should not count as user-level init.
    const report = buildReport([
      { file: '/home/user/.nvm/nvm.sh', line: 50, command: 'nvm_use_if_needed()' },
      { file: '/home/user/.nvm/nvm.sh', line: 100, command: 'nvm use default' },
    ]);
    expect(applyRules(report, {}).find((r) => r.rule === 'sync-version-managers')).toBeUndefined();
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

  describe('sync-version-managers — lazy-load snippet evidence', () => {
    it('embeds a paste-ready nvm shim in evidence when nvm fires', () => {
      const report = buildReport([
        { file: '.zshrc', line: 10, command: 'source ~/.nvm/nvm.sh' },
      ]);
      const rec = applyRules(report, {}).find((r) => r.rule === 'sync-version-managers');
      expect(rec).toBeDefined();
      const evidence = rec!.evidence.join('\n');
      expect(evidence).toContain('nvm →');
      expect(evidence).toContain('NVM_DIR');
      expect(evidence).toContain('nvm() {');
    });

    it('embeds the rbenv shim when rbenv fires', () => {
      const report = buildReport([
        { file: '.zshrc', line: 11, command: 'eval "$(rbenv init -)"' },
      ]);
      const rec = applyRules(report, {}).find((r) => r.rule === 'sync-version-managers');
      expect(rec).toBeDefined();
      const evidence = rec!.evidence.join('\n');
      expect(evidence).toContain('rbenv →');
      expect(evidence).toContain('rbenv() {');
    });
  });

  describe('guarded-source rule', () => {
    it('flags single-line `if [[ -f X ]]; then source X; fi`', () => {
      const sources = {
        '.zshrc': 'if [[ -f ~/.aliases ]]; then source ~/.aliases; fi\n',
      };
      const rec = applyRules(buildReport([]), sources).find((r) => r.rule === 'guarded-source');
      expect(rec).toBeDefined();
      expect(rec!.severity).toBe('info');
      expect(rec!.evidence[0]).toContain('~/.aliases');
    });

    it('flags multi-line `if/then/source/fi` blocks', () => {
      const sources = {
        '.bashrc': [
          'if [[ -f ~/.bash_local ]]; then',
          '  source ~/.bash_local',
          'fi',
          '',
        ].join('\n'),
      };
      const rec = applyRules(buildReport([]), sources).find((r) => r.rule === 'guarded-source');
      expect(rec).toBeDefined();
      expect(rec!.evidence[0]).toContain('~/.bash_local');
    });

    it('does not fire when the guarded path differs from the sourced path', () => {
      // `if [[ -f X ]]; then source Y; fi` is not the simplification target
      // — the test guards a different file than what's loaded.
      const sources = {
        '.zshrc': 'if [[ -f ~/.flag ]]; then source ~/.aliases; fi\n',
      };
      expect(
        applyRules(buildReport([]), sources).find((r) => r.rule === 'guarded-source'),
      ).toBeUndefined();
    });

    it('handles `.` as an alias for source', () => {
      const sources = {
        '.bashrc': 'if [[ -f ~/.local ]]; then . ~/.local; fi\n',
      };
      const rec = applyRules(buildReport([]), sources).find((r) => r.rule === 'guarded-source');
      expect(rec).toBeDefined();
    });
  });
});
