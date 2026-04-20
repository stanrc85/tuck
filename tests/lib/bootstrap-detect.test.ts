import { describe, it, expect, beforeEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { detectTool, DEFAULT_RC_FILES } from '../../src/lib/bootstrap/detect.js';
import type { ToolDefinition } from '../../src/schemas/bootstrap.schema.js';
import { TEST_HOME } from '../setup.js';

const tool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id: 'pet',
  description: 'CLI snippet manager',
  install: 'apt install pet',
  requires: [],
  detect: { paths: [], rcReferences: [] },
  ...overrides,
});

describe('detectTool', () => {
  beforeEach(() => {
    vol.mkdirSync(TEST_HOME, { recursive: true });
  });

  it('returns detected: false when a tool declares no signals', async () => {
    const result = await detectTool(tool());
    expect(result).toEqual({ detected: false, reasons: [] });
  });

  it('detects via detect.paths when a path exists', async () => {
    vol.mkdirSync(join(TEST_HOME, '.config/pet'), { recursive: true });
    const result = await detectTool(
      tool({ detect: { paths: ['~/.config/pet'], rcReferences: [] } })
    );
    expect(result.detected).toBe(true);
    expect(result.reasons).toEqual([{ kind: 'path', path: '~/.config/pet' }]);
  });

  it('records only the paths that actually exist', async () => {
    vol.mkdirSync(join(TEST_HOME, '.config/pet'), { recursive: true });
    const result = await detectTool(
      tool({
        detect: { paths: ['~/.config/pet', '~/.config/ghost'], rcReferences: [] },
      })
    );
    expect(result.reasons).toEqual([{ kind: 'path', path: '~/.config/pet' }]);
  });

  it('detects via rcReferences substring match in a default rc file', async () => {
    vol.writeFileSync(
      join(TEST_HOME, '.zshrc'),
      '# fuzzy finder\n[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh\n'
    );
    const result = await detectTool(
      tool({ detect: { paths: [], rcReferences: ['fzf.zsh'] } })
    );
    expect(result.detected).toBe(true);
    expect(result.reasons).toContainEqual({
      kind: 'rc',
      file: '~/.zshrc',
      ref: 'fzf.zsh',
    });
  });

  it('aggregates signals from both paths and rc files', async () => {
    vol.mkdirSync(join(TEST_HOME, '.config/pet'), { recursive: true });
    vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'alias p=pet\n');
    const result = await detectTool(
      tool({
        detect: { paths: ['~/.config/pet'], rcReferences: ['pet'] },
      })
    );
    expect(result.detected).toBe(true);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.reasons.some((r) => r.kind === 'path')).toBe(true);
    expect(result.reasons.some((r) => r.kind === 'rc')).toBe(true);
  });

  it('does not match when no rc file contains the reference', async () => {
    vol.writeFileSync(join(TEST_HOME, '.zshrc'), '# nothing here\n');
    const result = await detectTool(
      tool({ detect: { paths: [], rcReferences: ['fzf.zsh'] } })
    );
    expect(result).toEqual({ detected: false, reasons: [] });
  });

  it('honors options.rcFiles override when scanning a niche file', async () => {
    vol.mkdirSync(join(TEST_HOME, '.config/fish/conf.d'), { recursive: true });
    vol.writeFileSync(
      join(TEST_HOME, '.config/fish/conf.d/starship.fish'),
      'starship init fish | source\n'
    );
    const result = await detectTool(
      tool({ detect: { paths: [], rcReferences: ['starship init'] } }),
      { rcFiles: ['~/.config/fish/conf.d/starship.fish'] }
    );
    expect(result.detected).toBe(true);
    expect(result.reasons[0]).toMatchObject({ kind: 'rc', ref: 'starship init' });
  });

  it('records multiple rc matches when a reference appears in several files', async () => {
    vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'alias ls=eza\n');
    vol.writeFileSync(join(TEST_HOME, '.bashrc'), 'alias ls=eza\n');
    const result = await detectTool(
      tool({ detect: { paths: [], rcReferences: ['alias ls=eza'] } })
    );
    const rcMatches = result.reasons.filter((r) => r.kind === 'rc');
    expect(rcMatches.length).toBe(2);
  });

  it('tolerates missing rc files without crashing', async () => {
    // No rc files exist under TEST_HOME; detection should quietly return false.
    const result = await detectTool(
      tool({ detect: { paths: [], rcReferences: ['anything'] } })
    );
    expect(result).toEqual({ detected: false, reasons: [] });
  });

  it('DEFAULT_RC_FILES stays aligned with the test assumption', () => {
    // Guards against future edits that would silently break rcReferences tests.
    expect(DEFAULT_RC_FILES).toContain('~/.zshrc');
    expect(DEFAULT_RC_FILES).toContain('~/.bashrc');
  });
});
