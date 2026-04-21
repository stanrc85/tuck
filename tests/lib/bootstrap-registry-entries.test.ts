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

const expectedIds = [
  'fzf',
  'eza',
  'bat',
  'fd',
  'ripgrep',
  'neovim',
  'neovim-plugins',
  'pet',
  'yazi',
  'zsh',
  'zimfw',
];

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

  it('resolver orders zsh before zimfw (zimfw requires zsh)', () => {
    const order = resolveInstallOrder([...BUILT_IN_TOOLS]);
    const zshIdx = order.indexOf('zsh');
    const zimfwIdx = order.indexOf('zimfw');
    expect(zshIdx).toBeGreaterThanOrEqual(0);
    expect(zshIdx).toBeLessThan(zimfwIdx);
  });

  it('zimfw check + install both guard against Kali', () => {
    const zimfw = byId.zimfw!;
    // Check short-circuits to exit 0 on Kali so the tool is never flagged
    // as missing on hosts where Kali ships its own opinionated zsh setup.
    expect(zimfw.check).toContain('ID" = "kali"');
    expect(zimfw.check).toContain('exit 0');
    // Install belt-and-braces: even under `--rerun zimfw` on Kali, the
    // install script itself no-ops rather than clobbering Kali's setup.
    expect(zimfw.install).toContain('ID" = "kali"');
    expect(zimfw.install).toContain('Skipping ZimFW on Kali');
  });

  it('zimfw check accepts either canonical ~/.zim or the ZDOTDIR-resolved path', () => {
    // Covers both placements so a user in a mixed state (e.g. ~/.zim
    // from a pre-XDG install plus a later ZDOTDIR export in .zshenv)
    // doesn't get a false-positive reinstall loop. Canonical path is
    // checked first for speed (no zsh subshell); ZDOTDIR fallback only
    // runs when the canonical path is absent.
    const zimfw = byId.zimfw!;
    expect(zimfw.check).toContain('test -d "$HOME/.zim"');
    expect(zimfw.check).toContain('zsh -c');
    expect(zimfw.check).toContain('ZIM_HOME:-${ZDOTDIR:-$HOME}/.zim');
    // Fresh-host guard: if zsh isn't installed yet, the check must still
    // return non-zero (not try to run `zsh -c` and error out in a weird
    // way).
    expect(zimfw.check).toContain('command -v zsh');
  });

  it('pet check is a plain presence test — version drift is tracked via state.json', () => {
    // An earlier version grep'd `pet --version` for a version-literal
    // match; the output format isn't stable across pet releases (newer
    // versions route it through stderr on some builds), producing false
    // negatives and reinstall-on-every-restore. Version drift is handled
    // by the state.json definition-hash mechanism in the picker — check
    // only needs to confirm the binary is present.
    const pet = byId.pet!;
    expect(pet.check).toBe('command -v pet >/dev/null 2>&1');
    expect(pet.check).not.toContain('--version');
    expect(pet.check).not.toContain('grep');
  });

  it('bat install+update rebuild the theme cache so restored themes are registered', () => {
    // bat needs `bat cache --build` after new .tmTheme files land in
    // ~/.config/bat/themes — otherwise `bat --theme=Foo` reports
    // "unknown theme" even with the file on disk. Fallback to batcat is
    // needed because on Debian the apt package ships as `batcat` and our
    // own symlink may not be in PATH yet during the install script.
    const bat = byId.bat!;
    expect(bat.install).toContain('cache --build');
    expect(bat.install).toContain('BAT_BIN=');
    expect(bat.install).toContain('batcat');
    expect(bat.update).toContain('cache --build');
  });

  it('zimfw install pre-sets SHELL so the upstream installer skips its own chsh', () => {
    // The upstream zimfw install.zsh runs `chsh -s` itself when $SHELL
    // isn't zsh; under our `curl | zsh` pipe chsh's stdin is the closed
    // curl pipe, so PAM gets EOF before the user can type. Pre-setting
    // SHELL=<zsh path> satisfies the installer's check and defers the
    // login-shell change to tuck's own post-bootstrap prompt (which runs
    // against a real TTY). This assertion guards against regressing that
    // workaround on a future refactor.
    const zimfw = byId.zimfw!;
    expect(zimfw.install).toMatch(/SHELL="\$ZSH_PATH"\s+zsh/);
    expect(zimfw.install).toContain('command -v zsh');
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

  it('ripgrep detects via an rc reference', async () => {
    vol.writeFileSync(join(TEST_HOME, '.zshrc'), 'alias grep=ripgrep');
    const result = await detectTool(byId.ripgrep!);
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

  it('zsh detects via ~/.zshrc', async () => {
    vol.writeFileSync(join(TEST_HOME, '.zshrc'), '# zsh rc');
    const result = await detectTool(byId.zsh!);
    expect(result.detected).toBe(true);
  });

  it('zsh detects via XDG ~/.config/zsh directory', async () => {
    vol.mkdirSync(join(TEST_HOME, '.config/zsh'), { recursive: true });
    const result = await detectTool(byId.zsh!);
    expect(result.detected).toBe(true);
  });

  it('zimfw detects via ~/.zimrc', async () => {
    vol.writeFileSync(join(TEST_HOME, '.zimrc'), 'zmodule asciiship');
    const result = await detectTool(byId.zimfw!);
    expect(result.detected).toBe(true);
  });

  it('zimfw detects via XDG ~/.config/zsh/.zimrc', async () => {
    vol.mkdirSync(join(TEST_HOME, '.config/zsh'), { recursive: true });
    vol.writeFileSync(join(TEST_HOME, '.config/zsh/.zimrc'), 'zmodule asciiship');
    const result = await detectTool(byId.zimfw!);
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

  it('checks use `command -v` or `test -f/-d` form (not a heuristic)', () => {
    // Guards against a future edit introducing a check that happens to
    // `rm -rf` something — structural, not semantic, but catches egregious
    // drifts from the pattern.
    for (const tool of BUILT_IN_TOOLS) {
      const check = tool.check ?? '';
      const ok =
        check.includes('command -v') ||
        check.includes('test -f') ||
        check.includes('test -d');
      expect(ok, `${tool.id} check doesn't follow command-v/test-f/-d pattern: ${check}`).toBe(true);
    }
  });
});
