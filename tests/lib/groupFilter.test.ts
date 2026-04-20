import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupRequiredError } from '../../src/errors.js';

// vi.mock() factories are hoisted to the top of the file, so any helper they
// reference must be declared via vi.hoisted() to avoid "Cannot access X
// before initialization" errors.
const { loadConfigMock, getAllGroupsMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  getAllGroupsMock: vi.fn(),
}));

vi.mock('../../src/lib/config.js', () => ({
  loadConfig: loadConfigMock,
}));

vi.mock('../../src/lib/manifest.js', () => ({
  getAllGroups: getAllGroupsMock,
}));

import { resolveGroupFilter, assertHostGroupAssigned } from '../../src/lib/groupFilter.js';

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

describe('assertHostGroupAssigned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockResolvedValue({ defaultGroups: [] });
    getAllGroupsMock.mockResolvedValue([]);
  });

  it('passes when -g flag is supplied (one-shot override)', async () => {
    getAllGroupsMock.mockResolvedValue(['kubuntu', 'kali']);
    await expect(assertHostGroupAssigned('/t', { group: ['kali'] })).resolves.toBeUndefined();
    // -g short-circuits before config/manifest are consulted
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(getAllGroupsMock).not.toHaveBeenCalled();
  });

  it('passes when config.defaultGroups is non-empty', async () => {
    loadConfigMock.mockResolvedValue({ defaultGroups: ['kali'] });
    getAllGroupsMock.mockResolvedValue(['kubuntu', 'kali']);
    await expect(assertHostGroupAssigned('/t', {})).resolves.toBeUndefined();
    // manifest scan is short-circuited once config is sufficient
    expect(getAllGroupsMock).not.toHaveBeenCalled();
  });

  it('passes on single-group repo (no ambiguity to protect against)', async () => {
    getAllGroupsMock.mockResolvedValue(['default']);
    await expect(assertHostGroupAssigned('/t', {})).resolves.toBeUndefined();
  });

  it('passes on zero-group repo (legacy / pre-migration backwards-compat)', async () => {
    getAllGroupsMock.mockResolvedValue([]);
    await expect(assertHostGroupAssigned('/t', {})).resolves.toBeUndefined();
  });

  it('throws GroupRequiredError on multi-group repo with no -g and no defaults', async () => {
    getAllGroupsMock.mockResolvedValue(['kubuntu', 'kali']);
    await expect(assertHostGroupAssigned('/t', {})).rejects.toBeInstanceOf(GroupRequiredError);
  });

  it('throws GroupRequiredError listing the available groups in the message', async () => {
    getAllGroupsMock.mockResolvedValue(['kubuntu', 'kali']);
    await expect(assertHostGroupAssigned('/t', {})).rejects.toThrow(/kubuntu, kali/);
  });

  it('treats empty -g array as no flag (commander default) and falls through to config+manifest', async () => {
    // Commander gives options.group = [] when -g is absent, which must NOT
    // satisfy the gate — otherwise every call would pass trivially.
    getAllGroupsMock.mockResolvedValue(['kubuntu', 'kali']);
    await expect(assertHostGroupAssigned('/t', { group: [] })).rejects.toBeInstanceOf(
      GroupRequiredError
    );
  });
});
