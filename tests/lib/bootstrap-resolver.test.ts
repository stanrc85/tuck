import { describe, it, expect } from 'vitest';
import { resolveInstallOrder } from '../../src/lib/bootstrap/resolver.js';
import { BootstrapError } from '../../src/errors.js';

describe('resolveInstallOrder', () => {
  it('returns input order when no dependencies exist', () => {
    const order = resolveInstallOrder([
      { id: 'a', requires: [] },
      { id: 'b', requires: [] },
      { id: 'c', requires: [] },
    ]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('places a dependency before its dependent', () => {
    const order = resolveInstallOrder([
      { id: 'dependent', requires: ['dep'] },
      { id: 'dep', requires: [] },
    ]);
    expect(order.indexOf('dep')).toBeLessThan(order.indexOf('dependent'));
  });

  it('handles a longer chain (a -> b -> c -> d)', () => {
    const order = resolveInstallOrder([
      { id: 'd', requires: ['c'] },
      { id: 'c', requires: ['b'] },
      { id: 'b', requires: ['a'] },
      { id: 'a', requires: [] },
    ]);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles a diamond dependency without duplicating ids', () => {
    // a
    // ├─ b
    // └─ c
    //    └─ d  (requires b and c)
    const order = resolveInstallOrder([
      { id: 'd', requires: ['b', 'c'] },
      { id: 'c', requires: ['a'] },
      { id: 'b', requires: ['a'] },
      { id: 'a', requires: [] },
    ]);
    expect(order).toHaveLength(4);
    expect(new Set(order).size).toBe(4);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });

  it('preserves input relative order for independent subtrees', () => {
    const order = resolveInstallOrder([
      { id: 'lib-a', requires: [] },
      { id: 'lib-b', requires: [] },
      { id: 'consumer-a', requires: ['lib-a'] },
      { id: 'consumer-b', requires: ['lib-b'] },
    ]);
    // Both libs come before their consumers, and lib-a is declared before lib-b.
    expect(order.indexOf('lib-a')).toBeLessThan(order.indexOf('lib-b'));
    expect(order.indexOf('consumer-a')).toBeLessThan(order.indexOf('consumer-b'));
  });

  it('throws BootstrapError when a tool requires an unknown id', () => {
    expect(() =>
      resolveInstallOrder([{ id: 'dependent', requires: ['ghost'] }])
    ).toThrowError(BootstrapError);
  });

  it('unknown-requires error names both the dependent and the missing id', () => {
    try {
      resolveInstallOrder([{ id: 'pet', requires: ['zsh'] }]);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BootstrapError);
      expect((err as Error).message).toContain('pet');
      expect((err as Error).message).toContain('zsh');
    }
  });

  it('throws BootstrapError on a direct cycle (self-reference)', () => {
    expect(() =>
      resolveInstallOrder([{ id: 'loop', requires: ['loop'] }])
    ).toThrowError(BootstrapError);
  });

  it('throws BootstrapError on a two-node cycle (a <-> b)', () => {
    expect(() =>
      resolveInstallOrder([
        { id: 'a', requires: ['b'] },
        { id: 'b', requires: ['a'] },
      ])
    ).toThrowError(BootstrapError);
  });

  it('cycle error lists the participating ids in path order', () => {
    try {
      resolveInstallOrder([
        { id: 'a', requires: ['b'] },
        { id: 'b', requires: ['c'] },
        { id: 'c', requires: ['a'] },
      ]);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BootstrapError);
      const msg = (err as Error).message;
      expect(msg).toContain('a');
      expect(msg).toContain('b');
      expect(msg).toContain('c');
      // Closed-loop render: the start id should appear at the end too.
      expect(msg.match(/a/g)?.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns an empty array for an empty catalog', () => {
    expect(resolveInstallOrder([])).toEqual([]);
  });

  it('tolerates duplicate ids within the same `requires` array', () => {
    // Not a cycle, just redundant declaration — should still produce dep-first order.
    const order = resolveInstallOrder([
      { id: 'consumer', requires: ['dep', 'dep'] },
      { id: 'dep', requires: [] },
    ]);
    expect(order).toEqual(['dep', 'consumer']);
  });
});
