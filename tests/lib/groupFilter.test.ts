import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GroupRequiredError, HostReadOnlyError, HostRoleUnassignedError } from '../../src/errors.js';

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

import {
  resolveGroupFilter,
  assertHostGroupAssigned,
  assertHostNotReadOnly,
} from '../../src/lib/groupFilter.js';

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

describe('assertHostNotReadOnly', () => {
  const originalForceWriteEnv = process.env.TUCK_FORCE_WRITE;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TUCK_FORCE_WRITE;
    loadConfigMock.mockResolvedValue({ defaultGroups: [], readOnlyGroups: [] });
  });

  afterEach(() => {
    if (originalForceWriteEnv === undefined) {
      delete process.env.TUCK_FORCE_WRITE;
    } else {
      process.env.TUCK_FORCE_WRITE = originalForceWriteEnv;
    }
  });

  it('passes when readOnlyGroups is empty (feature not configured)', async () => {
    loadConfigMock.mockResolvedValue({ defaultGroups: ['kubuntu'], readOnlyGroups: [] });
    await expect(assertHostNotReadOnly('/t')).resolves.toBeUndefined();
  });

  it("passes when host's defaultGroups don't intersect readOnlyGroups (producer host)", async () => {
    loadConfigMock.mockResolvedValue({
      defaultGroups: ['kubuntu'],
      readOnlyGroups: ['kali'],
    });
    await expect(assertHostNotReadOnly('/t')).resolves.toBeUndefined();
  });

  it("throws HostReadOnlyError when host's defaultGroups intersect readOnlyGroups", async () => {
    loadConfigMock.mockResolvedValue({
      defaultGroups: ['kali'],
      readOnlyGroups: ['kali'],
    });
    await expect(assertHostNotReadOnly('/t')).rejects.toBeInstanceOf(HostReadOnlyError);
  });

  it('names the matched group(s) in the HostReadOnlyError message', async () => {
    loadConfigMock.mockResolvedValue({
      defaultGroups: ['kali', 'extra'],
      readOnlyGroups: ['kali', 'other'],
    });
    await expect(assertHostNotReadOnly('/t')).rejects.toThrow(/kali/);
  });

  it('throws HostRoleUnassignedError when readOnlyGroups is set but host has no defaultGroups', async () => {
    loadConfigMock.mockResolvedValue({ defaultGroups: [], readOnlyGroups: ['kali'] });
    await expect(assertHostNotReadOnly('/t')).rejects.toBeInstanceOf(HostRoleUnassignedError);
  });

  it('throws HostRoleUnassignedError when defaultGroups field is absent entirely', async () => {
    // Defensive: partial configs without a defaultGroups key should still gate.
    loadConfigMock.mockResolvedValue({ readOnlyGroups: ['kali'] });
    await expect(assertHostNotReadOnly('/t')).rejects.toBeInstanceOf(HostRoleUnassignedError);
  });

  it('--force-write bypasses the gate even when host is in a read-only group', async () => {
    loadConfigMock.mockResolvedValue({
      defaultGroups: ['kali'],
      readOnlyGroups: ['kali'],
    });
    await expect(
      assertHostNotReadOnly('/t', { forceWrite: true })
    ).resolves.toBeUndefined();
    // loadConfig should short-circuit before being called — we bail on forceWrite first
    expect(loadConfigMock).not.toHaveBeenCalled();
  });

  it('TUCK_FORCE_WRITE=true env var bypasses the gate', async () => {
    process.env.TUCK_FORCE_WRITE = 'true';
    loadConfigMock.mockResolvedValue({
      defaultGroups: ['kali'],
      readOnlyGroups: ['kali'],
    });
    await expect(assertHostNotReadOnly('/t')).resolves.toBeUndefined();
    expect(loadConfigMock).not.toHaveBeenCalled();
  });

  it('HostReadOnlyError carries remediation suggestions', async () => {
    loadConfigMock.mockResolvedValue({
      defaultGroups: ['kali'],
      readOnlyGroups: ['kali'],
    });
    try {
      await assertHostNotReadOnly('/t');
      expect.fail('should have thrown');
    } catch (err: unknown) {
      const tuckErr = err as { code?: string; suggestions?: string[] };
      expect(tuckErr.code).toBe('HOST_READ_ONLY');
      expect(tuckErr.suggestions).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/tuck update/),
          expect.stringMatching(/--force-write|TUCK_FORCE_WRITE/),
        ])
      );
    }
  });

  it('HostRoleUnassignedError carries role-declaration suggestions', async () => {
    loadConfigMock.mockResolvedValue({ defaultGroups: [], readOnlyGroups: ['kali'] });
    try {
      await assertHostNotReadOnly('/t');
      expect.fail('should have thrown');
    } catch (err: unknown) {
      const tuckErr = err as { code?: string; suggestions?: string[] };
      expect(tuckErr.code).toBe('HOST_ROLE_UNASSIGNED');
      expect(tuckErr.suggestions).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/tuck config set defaultGroups/),
        ])
      );
    }
  });
});
