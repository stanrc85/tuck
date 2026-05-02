import { describe, it, expect } from 'vitest';
import { synthesizeTool } from '../../src/lib/bootstrap/installerSynth.js';
import { parseBootstrapConfig } from '../../src/lib/bootstrap/parser.js';
import { BootstrapError } from '../../src/errors.js';

const baseTool = {
  id: 'brew-cli-utils',
  description: 'CLIs managed by Homebrew',
  requires: [],
  detect: { paths: [], rcReferences: [] },
  associatedConfig: [],
};

describe('synthesizeTool', () => {
  describe('installer = "brew"', () => {
    it('expands string-shorthand packages into install/check/update', () => {
      const result = synthesizeTool({
        ...baseTool,
        installer: 'brew',
        packages: ['fzf', 'bat', 'eza'],
      });

      expect(result.install).toContain('"$BREW" install fzf bat eza');
      expect(result.install).toContain('BREW=/home/linuxbrew/.linuxbrew/bin/brew');
      expect(result.install).toMatch(/^set -e/);

      expect(result.check).toContain('for bin in fzf bat eza');
      expect(result.check).toContain(
        'test -x "/home/linuxbrew/.linuxbrew/bin/$bin" || exit 1'
      );

      expect(result.update).toContain('"$BREW" update');
      expect(result.update).toContain('"$BREW" upgrade fzf bat eza || true');
    });

    it('honors {name, bin} when formula and binary differ', () => {
      const result = synthesizeTool({
        ...baseTool,
        installer: 'brew',
        packages: [
          'fzf',
          { name: 'neovim', bin: 'nvim' },
          { name: 'ripgrep', bin: 'rg' },
          { name: 'tealdeer', bin: 'tldr' },
        ],
      });

      expect(result.install).toContain('"$BREW" install fzf neovim ripgrep tealdeer');
      expect(result.update).toContain(
        '"$BREW" upgrade fzf neovim ripgrep tealdeer || true'
      );
      expect(result.check).toContain('for bin in fzf nvim rg tldr');
    });

    it('appends postInstall and postUpdate to the synthesized scripts', () => {
      const result = synthesizeTool({
        ...baseTool,
        installer: 'brew',
        packages: ['neovim', 'tealdeer'],
        postInstall:
          'sudo ln -sf /home/linuxbrew/.linuxbrew/bin/nvim /usr/local/bin/nvim\n/home/linuxbrew/.linuxbrew/bin/tldr --update || true',
        postUpdate: '/home/linuxbrew/.linuxbrew/bin/tldr --update || true',
      });

      expect(result.install).toContain('sudo ln -sf');
      expect(result.install).toContain('tldr --update || true');
      // postInstall comes AFTER the brew install line
      const installPos = result.install.indexOf('"$BREW" install');
      const lnPos = result.install.indexOf('sudo ln -sf');
      expect(lnPos).toBeGreaterThan(installPos);

      expect(result.update).toContain('"$BREW" upgrade neovim tealdeer || true');
      expect(result.update).toContain('tldr --update || true');
    });

    it('treats {name} (no bin) as bin defaulting to name', () => {
      const result = synthesizeTool({
        ...baseTool,
        installer: 'brew',
        packages: [{ name: 'fzf' }],
      });

      expect(result.check).toContain('for bin in fzf');
      expect(result.install).toContain('"$BREW" install fzf');
    });
  });

  describe('installer = "apt"', () => {
    it('expands packages into apt-get install + dpkg -s check', () => {
      const result = synthesizeTool({
        ...baseTool,
        id: 'dev-utilities',
        installer: 'apt',
        packages: ['dtrx', 'ffmpeg', '7zip', 'build-essential'],
      });

      expect(result.install).toContain(
        'sudo apt-get install -y dtrx ffmpeg 7zip build-essential'
      );
      expect(result.install).toMatch(/^set -e/);

      expect(result.check).toContain('for pkg in dtrx ffmpeg 7zip build-essential');
      expect(result.check).toContain('dpkg -s "$pkg" >/dev/null 2>&1 || exit 1');

      expect(result.update).toContain(
        'sudo apt-get install -y --only-upgrade dtrx ffmpeg 7zip build-essential'
      );
    });

    it('honors postInstall and postUpdate for apt blocks', () => {
      const result = synthesizeTool({
        ...baseTool,
        id: 'dev-utilities',
        installer: 'apt',
        packages: ['imagemagick'],
        postInstall: 'echo "imagemagick policies tweaked"',
        postUpdate: 'echo "post-upgrade hook"',
      });

      expect(result.install).toContain('echo "imagemagick policies tweaked"');
      expect(result.update).toContain('echo "post-upgrade hook"');
    });
  });

  describe('passthrough', () => {
    it('returns raw-script tools unchanged', () => {
      const result = synthesizeTool({
        ...baseTool,
        id: 'pet',
        install: 'curl ... | bash',
        check: 'command -v pet',
        update: '@install',
      });

      expect(result.install).toBe('curl ... | bash');
      expect(result.check).toBe('command -v pet');
      expect(result.update).toBe('@install');
    });
  });
});

describe('parseBootstrapConfig with installer shorthand', () => {
  it('expands brew shorthand end-to-end and produces runnable scripts', () => {
    const toml = `
[[tool]]
id = "brew-cli-utils"
description = "CLIs managed by Homebrew"
requires = ["homebrew"]
installer = "brew"
packages = [
  "fzf", "bat", "eza",
  { name = "neovim", bin = "nvim" },
  { name = "ripgrep", bin = "rg" },
]
postInstall = "/home/linuxbrew/.linuxbrew/bin/bat cache --build >/dev/null 2>&1 || true"
`;
    const config = parseBootstrapConfig(toml);
    const tool = config.tool[0];
    expect(tool.id).toBe('brew-cli-utils');
    expect(tool.install).toContain('"$BREW" install fzf bat eza neovim ripgrep');
    expect(tool.install).toContain('bat cache --build');
    expect(tool.check).toContain('for bin in fzf bat eza nvim rg');
    expect(tool.update).toContain('"$BREW" upgrade fzf bat eza neovim ripgrep || true');
    // installer/packages/postInstall stay on the object for introspection
    expect(tool.installer).toBe('brew');
    expect(tool.packages).toHaveLength(5);
  });

  it('rejects mixing installer with raw install', () => {
    const toml = `
[[tool]]
id = "broken"
description = "broken"
installer = "brew"
packages = ["fzf"]
install = "manual install"
`;
    expect(() => parseBootstrapConfig(toml)).toThrow(BootstrapError);
    expect(() => parseBootstrapConfig(toml)).toThrow(/pick one mode/);
  });

  it('rejects installer without packages', () => {
    const toml = `
[[tool]]
id = "broken"
description = "broken"
installer = "brew"
`;
    expect(() => parseBootstrapConfig(toml)).toThrow(/non-empty .*packages/);
  });

  it('rejects installer with empty packages array', () => {
    const toml = `
[[tool]]
id = "broken"
description = "broken"
installer = "brew"
packages = []
`;
    expect(() => parseBootstrapConfig(toml)).toThrow(/non-empty .*packages/);
  });

  it('rejects packages without installer', () => {
    const toml = `
[[tool]]
id = "broken"
description = "broken"
install = "echo hi"
packages = ["fzf"]
`;
    expect(() => parseBootstrapConfig(toml)).toThrow(/packages.*only valid when .*installer/);
  });

  it('rejects postInstall without installer', () => {
    const toml = `
[[tool]]
id = "broken"
description = "broken"
install = "echo hi"
postInstall = "echo done"
`;
    expect(() => parseBootstrapConfig(toml)).toThrow(/postInstall.*only valid when .*installer/);
  });

  it('rejects bin field on apt packages', () => {
    const toml = `
[[tool]]
id = "broken"
description = "broken"
installer = "apt"
packages = [{ name = "neovim", bin = "nvim" }]
`;
    expect(() => parseBootstrapConfig(toml)).toThrow(/bin.*brew-only/);
  });

  it('rejects neither install nor installer', () => {
    const toml = `
[[tool]]
id = "broken"
description = "broken"
`;
    expect(() => parseBootstrapConfig(toml)).toThrow(/missing .*install/);
  });

  it('rejects check/update with installer (auto-generated)', () => {
    const tomlCheck = `
[[tool]]
id = "broken"
description = "broken"
installer = "brew"
packages = ["fzf"]
check = "command -v fzf"
`;
    expect(() => parseBootstrapConfig(tomlCheck)).toThrow(/check.*auto-generated/);

    const tomlUpdate = `
[[tool]]
id = "broken"
description = "broken"
installer = "brew"
packages = ["fzf"]
update = "brew upgrade fzf"
`;
    expect(() => parseBootstrapConfig(tomlUpdate)).toThrow(/update.*auto-generated/);
  });
});
