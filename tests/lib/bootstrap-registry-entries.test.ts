import { describe, it, expect, beforeEach } from 'vitest';
import { vol } from 'memfs';
import { join } from 'path';
import { BUILT_IN_TOOLS } from '../../src/lib/bootstrap/registry/index.js';
import { bootstrapConfigSchema } from '../../src/schemas/bootstrap.schema.js';
import { detectTool } from '../../src/lib/bootstrap/detect.js';
import {
  interpolate,
  type BootstrapVars,
} from '../../src/lib/bootstrap/interpolator.js';
import { resolveInstallOrder } from '../../src/lib/bootstrap/resolver.js';
import { TEST_HOME } from '../setup.js';

const expectedIds = ['fzf', 'eza', 'bat', 'fd', 'neovim', 'neovim-plugins', 'pet', 'yazi'];

const byId = Object.fromEntries(BUILT_IN_TOOLS.map((t) => [t.id, t]));

const vars: BootstrapVars = {
  VERSION: '1.0.0',
  ARCH: 'amd64',
  HOME: '/test-home',
  OS: 'linux',
  TUCK_DIR: '/test-home/.tuck',
};

describe('BUILT_IN_TOOLS catalog', () => {
  it('exposes the expected built-in ids', () => {
    expect(BUILT_IN_TOOLS.map((t) => t.id).sort()).toEqual([...expectedIds].sort());
  });

  it('every entry round-trips through the schema (guards against drift)', () => {
    // Feed BUILT_IN_TOOLS through the schema as if it were a user's
    // bootstrap.toml. If an entry violates the schema, this fails loudly
    // rather than letting runtime callers see the inconsistency.
    const result = bootstrapConfigSchema.safeParse({ tool: [...BUILT_IN_TOOLS] });
    expect(result.success).toBe(true);
  });

  it('every entry has an install command and a description', () => {
    for (const tool of BUILT_IN_TOOLS) {
      expect(tool.install.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('ids are unique', () => {
    const ids = BUILT_IN_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('registry requires graph', () => {
  it('resolver produces a valid install order with neovim before neovim-plugins', () => {
    const order = resolveInstallOrder([...BUILT_IN_TOOLS]);
    const neovimIdx = order.indexOf('neovim');
    const pluginsIdx = order.indexOf('neovim-plugins');
    expect(neovimIdx).toBeGreaterThanOrEqual(0);
    expect(neovimIdx).toBeLessThan(pluginsIdx);
  });

  it('all `requires` targets exist in the catalog (no dangling refs)', () => {
    const ids = new Set(BUILT_IN_TOOLS.map((t) => t.id));
    for (const tool of BUILT_IN_TOOLS) {
      for (const req of tool.requires) {
        expect(ids.has(req), `${tool.id} requires "${req}" which isn't in the catalog`).toBe(true);
      }
    }
  });
});

describe('interpolation', () => {
  it('every script interpolates without throwing under the full var set', () => {
    for (const tool of BUILT_IN_TOOLS) {
      const toolVars: BootstrapVars = { ...vars, VERSION: tool.version };
      // Scripts that reference ${VERSION} must have a version field.
      for (const field of ['install', 'update', 'check'] as const) {
        const script = tool[field];
        if (!script) continue;
        if (script.includes('${VERSION}') && tool.version === undefined) {
          throw new Error(
            `${tool.id}.${field} references \${VERSION} but has no version field`
          );
        }
        expect(() => interpolate(script, toolVars)).not.toThrow();
      }
    }
  });

  it('version-pinned tools have non-empty versions', () => {
    for (const tool of BUILT_IN_TOOLS) {
      if (tool.version !== undefined) {
        expect(tool.version.length).toBeGreaterThan(0);
      }
    }
  });

  it('pet install URL interpolates to a concrete Debian-style .deb', () => {
    const toolVars: BootstrapVars = { ...vars, VERSION: byId.pet!.version };
    const rendered = interpolate(byId.pet!.install, toolVars);
    expect(rendered).toContain(`pet_${byId.pet!.version}_linux_amd64.deb`);
  });

  it('yazi install script leaves $(uname -m) untouched for shell expansion', () => {
    const toolVars: BootstrapVars = { ...vars, VERSION: byId.yazi!.version };
    const rendered = interpolate(byId.yazi!.install, toolVars);
    expect(rendered).toContain('$(uname -m)');
    expect(rendered).toContain(`/v${byId.yazi!.version}/yazi-`);
  });
});

describe('detection fixtures', () => {
  beforeEach(() => {
    vol.mkdirSync(TEST_HOME, { recursive: true });
  });

  it('fzf detects via ~/.fzf.zsh', async () => {
    vol.writeFileSync(join(TEST_HOME, '.fzf.zsh'), '# fzf');
    const result = await detectTool(byId.fzf!);
    expect(result.detected).toBe(true);
  });

  it('fzf detects via rcReferences in .zshrc', async () => {
    vol.writeFileSync(join(TEST_HOME, '.zshrc'), '[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh');
    const result = await detectTool(byId.fzf!);
    expect(result.detected).toBe(true);
  });

  it('eza detects via an alias in shell rc', async () => {
    vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'alias ls=eza');
    const result = await detectTool(byId.eza!);
    expect(result.detected).toBe(true);
  });

  it('bat detects via ~/.config/bat', async () => {
    vol.mkdirSync(join(TEST_HOME, '.config/bat'), { recursive: true });
    const result = await detectTool(byId.bat!);
    expect(result.detected).toBe(true);
  });

  it('neovim detects via ~/.config/nvim', async () => {
    vol.mkdirSync(join(TEST_HOME, '.config/nvim'), { recursive: true });
    const result = await detectTool(byId.neovim!);
    expect(result.detected).toBe(true);
  });

  it('neovim-plugins detects via lazy-lock.json presence', async () => {
    vol.mkdirSync(join(TEST_HOME, '.config/nvim'), { recursive: true });
    vol.writeFileSync(join(TEST_HOME, '.config/nvim/lazy-lock.json'), '{}');
    const result = await detectTool(byId['neovim-plugins']!);
    expect(result.detected).toBe(true);
  });

  it('pet detects via ~/.config/pet', async () => {
    vol.mkdirSync(join(TEST_HOME, '.config/pet'), { recursive: true });
    const result = await detectTool(byId.pet!);
    expect(result.detected).toBe(true);
  });

  it('yazi detects via ~/.config/yazi', async () => {
    vol.mkdirSync(join(TEST_HOME, '.config/yazi'), { recursive: true });
    const result = await detectTool(byId.yazi!);
    expect(result.detected).toBe(true);
  });

  it('nothing detected on a pristine home', async () => {
    // No config dirs, no rc files.
    for (const tool of BUILT_IN_TOOLS) {
      const result = await detectTool(tool);
      expect(result.detected, `${tool.id} should not detect on pristine home`).toBe(false);
    }
  });
});

describe('check command shape (structural — no execution)', () => {
  it('every tool has a check command', () => {
    for (const tool of BUILT_IN_TOOLS) {
      expect(tool.check, `${tool.id} missing check`).toBeDefined();
      expect(tool.check!.length).toBeGreaterThan(0);
    }
  });

  it('checks use `command -v` or `test -f` form (not a heuristic)', () => {
    // Guards against a future edit introducing a check that happens to
    // `rm -rf` something — structural, not semantic, but catches egregious
    // drifts from the pattern.
    for (const tool of BUILT_IN_TOOLS) {
      const check = tool.check ?? '';
      const ok = check.includes('command -v') || check.includes('test -f');
      expect(ok, `${tool.id} check doesn't follow command-v/test-f pattern: ${check}`).toBe(true);
    }
  });
});
