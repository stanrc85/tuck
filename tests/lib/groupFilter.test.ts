import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock() factories are hoisted to the top of the file, so any helper they
// reference must be declared via vi.hoisted() to avoid "Cannot access X
// before initialization" errors.
const { loadConfigMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
}));

vi.mock('../../src/lib/config.js', () => ({
  loadConfig: loadConfigMock,
}));

import { resolveGroupFilter } from '../../src/lib/groupFilter.js';

describe('resolveGroupFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockResolvedValue({ defaultGroups: [] });
  });

  it('returns the CLI -g flag when non-empty (wins over config)', async () => {
    loadConfigMock.mockResolvedValue({ defaultGroups: ['kubuntu'] });
    const result = await resolveGroupFilter('/t', { group: ['kali'] });
    expect(result).toEqual(['kali']);
    // Precedence: options.group short-circuits before loadConfig is consulted
    expect(loadConfigMock).not.toHaveBeenCalled();
  });

  it('falls back to config.defaultGroups when -g is omitted', async () => {
    loadConfigMock.mockResolvedValue({ defaultGroups: ['kali'] });
    const result = await resolveGroupFilter('/t', {});
    expect(result).toEqual(['kali']);
  });

  it('falls back to config.defaultGroups when -g is an empty array', async () => {
    // Commander's default for an unused `-g` option is `[]`, not undefined.
    loadConfigMock.mockResolvedValue({ defaultGroups: ['kali'] });
    const result = await resolveGroupFilter('/t', { group: [] });
    expect(result).toEqual(['kali']);
  });

  it('returns undefined when neither -g nor config.defaultGroups is set', async () => {
    loadConfigMock.mockResolvedValue({ defaultGroups: [] });
    const result = await resolveGroupFilter('/t', {});
    expect(result).toBeUndefined();
  });

  it('returns undefined when config returns no defaultGroups field at all', async () => {
    // Partial mocks may not populate every field — helper must not throw.
    loadConfigMock.mockResolvedValue({});
    const result = await resolveGroupFilter('/t', {});
    expect(result).toBeUndefined();
  });

  it('tolerates config being undefined (defensive against partial test mocks)', async () => {
    loadConfigMock.mockResolvedValue(undefined);
    const result = await resolveGroupFilter('/t', {});
    expect(result).toBeUndefined();
  });
});
