import { describe, it, expect } from 'vitest';
import { mergeWithRegistry, BUILT_IN_TOOLS } from '../../src/lib/bootstrap/registry/index.js';
import type {
  BootstrapConfig,
  ToolDefinition,
} from '../../src/schemas/bootstrap.schema.js';

const tool = (id: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id,
  description: `desc for ${id}`,
  install: `install-${id}`,
  requires: [],
  detect: { paths: [], rcReferences: [] },
  ...overrides,
});

const config = (overrides: Partial<BootstrapConfig> = {}): BootstrapConfig => ({
  tool: [],
  bundles: {},
  registry: { disabled: [] },
  ...overrides,
});

describe('mergeWithRegistry', () => {
  it('returns user tools unchanged when built-ins are empty', () => {
    const user = [tool('pet'), tool('custom')];
    const result = mergeWithRegistry(config({ tool: user }), { builtIns: [] });
    expect(result.map((t) => t.id)).toEqual(['pet', 'custom']);
  });

  it('appends un-disabled built-ins after user tools', () => {
    const result = mergeWithRegistry(
      config({ tool: [tool('my-tool')] }),
      { builtIns: [tool('fzf'), tool('eza')] }
    );
    expect(result.map((t) => t.id)).toEqual(['my-tool', 'fzf', 'eza']);
  });

  it('drops built-ins listed in registry.disabled', () => {
    const result = mergeWithRegistry(
      config({ registry: { disabled: ['yazi'] } }),
      { builtIns: [tool('fzf'), tool('yazi'), tool('bat')] }
    );
    expect(result.map((t) => t.id)).toEqual(['fzf', 'bat']);
  });

  it('user tool overrides built-in with the same id (user wins)', () => {
    const user = tool('fzf', { install: 'apt install my-custom-fzf' });
    const builtIn = tool('fzf', { install: 'apt install fzf' });
    const result = mergeWithRegistry(
      config({ tool: [user] }),
      { builtIns: [builtIn, tool('eza')] }
    );
    expect(result.map((t) => t.id)).toEqual(['fzf', 'eza']);
    expect(result[0]?.install).toBe('apt install my-custom-fzf');
  });

  it('disable + user-override both apply (built-in dropped, user wins)', () => {
    // Disabling only affects built-ins; a user tool with the same id stays.
    const user = tool('yazi', { install: 'from source' });
    const result = mergeWithRegistry(
      config({ tool: [user], registry: { disabled: ['yazi'] } }),
      { builtIns: [tool('yazi', { install: 'apt install yazi' }), tool('fzf')] }
    );
    expect(result.map((t) => t.id)).toEqual(['yazi', 'fzf']);
    expect(result[0]?.install).toBe('from source');
  });

  it('no-ops cleanly when both user and built-ins are empty', () => {
    expect(mergeWithRegistry(config(), { builtIns: [] })).toEqual([]);
  });

  it('preserves user order (declared) and built-in order (catalog)', () => {
    const result = mergeWithRegistry(
      config({ tool: [tool('c'), tool('a'), tool('b')] }),
      { builtIns: [tool('z'), tool('y'), tool('x')] }
    );
    expect(result.map((t) => t.id)).toEqual(['c', 'a', 'b', 'z', 'y', 'x']);
  });

  it('disabling an id that has no built-in is a harmless no-op', () => {
    // Guards against breakage if a user leaves `disabled = ["old-name"]` in
    // their toml after the built-in was renamed — shouldn't error, shouldn't
    // filter a user tool with the same id.
    const result = mergeWithRegistry(
      config({ tool: [tool('fzf')], registry: { disabled: ['never-existed'] } }),
      { builtIns: [tool('eza')] }
    );
    expect(result.map((t) => t.id)).toEqual(['fzf', 'eza']);
  });

  it('defaults to the real BUILT_IN_TOOLS when options.builtIns is omitted', () => {
    // TASK-021 ships an empty registry; TASK-022 will populate it. This test
    // pins the contract that the registry is accessible without injection.
    const result = mergeWithRegistry(config({ tool: [tool('only-user')] }));
    expect(result.map((t) => t.id)).toEqual(['only-user']);
    expect(BUILT_IN_TOOLS).toEqual([]);
  });
});
