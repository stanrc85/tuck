import { describe, it, expect } from 'vitest';
import { parseBootstrapConfig } from '../../src/lib/bootstrap/parser.js';
import { BootstrapError } from '../../src/errors.js';

const FULL_TOML = `
[[tool]]
id = "pet"
description = "CLI snippet manager"
category = "shell"
version = "1.0.1"
requires = ["fzf"]
check = "command -v pet"
install = """
curl -fsSL .../v\${VERSION}/pet_\${VERSION}_\${OS}_\${ARCH}.deb -o /tmp/pet.deb
sudo dpkg -i /tmp/pet.deb
"""
update = "@install"

[tool.detect]
paths = ["~/.config/pet"]
rcReferences = []

[[tool]]
id = "fzf"
description = "fuzzy finder"
install = "apt install -y fzf"

[bundles]
kali = ["fzf", "pet"]
minimal = ["fzf"]

[registry]
disabled = ["yazi"]
`;

describe('parseBootstrapConfig', () => {
  it('parses a fully-populated catalog and returns typed output', () => {
    const config = parseBootstrapConfig(FULL_TOML);

    expect(config.tool).toHaveLength(2);

    const pet = config.tool.find((t) => t.id === 'pet');
    expect(pet).toBeDefined();
    expect(pet?.description).toBe('CLI snippet manager');
    expect(pet?.category).toBe('shell');
    expect(pet?.version).toBe('1.0.1');
    expect(pet?.requires).toEqual(['fzf']);
    expect(pet?.check).toBe('command -v pet');
    expect(pet?.install).toContain('dpkg -i');
    expect(pet?.update).toBe('@install');
    expect(pet?.detect.paths).toEqual(['~/.config/pet']);

    expect(config.bundles).toEqual({ kali: ['fzf', 'pet'], minimal: ['fzf'] });
    expect(config.registry.disabled).toEqual(['yazi']);
  });

  it('accepts a minimal tool (only id, description, install)', () => {
    const config = parseBootstrapConfig(`
[[tool]]
id = "fzf"
description = "fuzzy finder"
install = "apt install fzf"
`);
    const fzf = config.tool[0];
    expect(fzf?.id).toBe('fzf');
    expect(fzf?.requires).toEqual([]);
    expect(fzf?.detect.paths).toEqual([]);
    expect(fzf?.detect.rcReferences).toEqual([]);
    expect(fzf?.version).toBeUndefined();
    expect(fzf?.update).toBeUndefined();
  });

  it('returns empty collections for a truly empty file', () => {
    const config = parseBootstrapConfig('');
    expect(config.tool).toEqual([]);
    expect(config.bundles).toEqual({});
    expect(config.registry.disabled).toEqual([]);
  });

  it('surfaces TOML syntax errors with line number', () => {
    const bad = `
[[tool]]
id = "pet"
description = "missing quote
install = "ok"
`;
    expect(() => parseBootstrapConfig(bad)).toThrowError(BootstrapError);
    try {
      parseBootstrapConfig(bad);
    } catch (err) {
      expect((err as Error).message).toMatch(/line \d+/);
    }
  });

  it('rejects tool missing required `install` field', () => {
    const bad = `
[[tool]]
id = "fzf"
description = "fuzzy"
`;
    expect(() => parseBootstrapConfig(bad)).toThrowError(BootstrapError);
  });

  it('rejects a tool id that is not kebab/snake case', () => {
    const bad = `
[[tool]]
id = "Bad Tool!"
description = "x"
install = "x"
`;
    expect(() => parseBootstrapConfig(bad)).toThrowError(BootstrapError);
  });

  it('rejects empty description', () => {
    const bad = `
[[tool]]
id = "fzf"
description = ""
install = "apt install fzf"
`;
    expect(() => parseBootstrapConfig(bad)).toThrowError(BootstrapError);
  });

  it('rejects duplicate tool ids and names all of them', () => {
    const bad = `
[[tool]]
id = "fzf"
description = "a"
install = "x"

[[tool]]
id = "fzf"
description = "b"
install = "y"
`;
    try {
      parseBootstrapConfig(bad);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BootstrapError);
      expect((err as Error).message).toContain('fzf');
      expect((err as Error).message.toLowerCase()).toContain('duplicate');
    }
  });

  it('does NOT pre-validate bundle cross-refs (plan-time handles it)', () => {
    // Bundles may legitimately reference built-in registry tools that
    // aren't in the user's `[[tool]]` array. Validation happens at plan
    // time (against the merged catalog), not at parse time.
    const config = parseBootstrapConfig(`
[[tool]]
id = "fzf"
description = "fuzzy"
install = "apt install fzf"

[bundles]
kali = ["fzf", "pet-from-builtin-registry"]
`);
    expect(config.bundles.kali).toEqual(['fzf', 'pet-from-builtin-registry']);
  });

  it('does NOT pre-validate `requires` cross-refs (resolver handles it)', () => {
    // The user's catalog may reference built-in registry IDs not present in
    // this file. The parser must stay silent; the resolver (after merging
    // the built-in registry) decides if the ref is unknown.
    const config = parseBootstrapConfig(`
[[tool]]
id = "pet"
description = "CLI snippet manager"
install = "x"
requires = ["fzf-from-builtin-registry"]
`);
    expect(config.tool[0]?.requires).toEqual(['fzf-from-builtin-registry']);
  });

  it('rejects non-string ids in bundles via the toolIdSchema (strong refs)', () => {
    const bad = `
[bundles]
kali = ["Bad Id!"]
`;
    expect(() => parseBootstrapConfig(bad)).toThrowError(BootstrapError);
  });

  it('includes the source path in error messages when provided', () => {
    const bad = `[[tool]]
id = "ok"
description = "x"
`; // missing install
    try {
      parseBootstrapConfig(bad, '/repos/dotfiles/bootstrap.toml');
      expect.fail('expected throw');
    } catch (err) {
      expect((err as Error).message).toContain('/repos/dotfiles/bootstrap.toml');
    }
  });

  it('snake_case and hyphenated ids are both valid', () => {
    const config = parseBootstrapConfig(`
[[tool]]
id = "neovim_plugins"
description = "a"
install = "x"

[[tool]]
id = "neovim-plugins2"
description = "b"
install = "y"
`);
    expect(config.tool.map((t) => t.id)).toEqual(['neovim_plugins', 'neovim-plugins2']);
  });
});
