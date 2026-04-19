import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  compareVersions,
  stripLeadingV,
  fetchLatestRelease,
  fetchReleaseByTag,
  detectInstallOrigin,
  UpdaterError,
  RELEASE_ASSET_NAME,
} from '../../src/lib/updater.js';

const sampleRelease = (overrides: Partial<Record<string, unknown>> = {}) => ({
  tag_name: 'v1.3.0',
  name: 'v1.3.0',
  published_at: '2026-04-20T12:00:00Z',
  html_url: 'https://github.com/stanrc85/tuck/releases/tag/v1.3.0',
  draft: false,
  prerelease: false,
  assets: [
    {
      name: RELEASE_ASSET_NAME,
      browser_download_url:
        'https://github.com/stanrc85/tuck/releases/download/v1.3.0/tuck.tgz',
    },
  ],
  ...overrides,
});

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
  });

  it('ignores leading v on either side', () => {
    expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0', 'V1.2.0')).toBe(0);
  });

  it('returns negative when a < b across major/minor/patch', () => {
    expect(compareVersions('1.2.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.3.0')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.2.1')).toBeLessThan(0);
  });

  it('returns positive when a > b', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0);
  });

  it('treats pre-release suffixes as the base version for ordering', () => {
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBe(0);
  });

  it('pads missing segments with 0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
  });
});

describe('stripLeadingV', () => {
  it('strips lowercase v', () => {
    expect(stripLeadingV('v1.2.0')).toBe('1.2.0');
  });
  it('strips uppercase V', () => {
    expect(stripLeadingV('V1.2.0')).toBe('1.2.0');
  });
  it('is a no-op when no leading v', () => {
    expect(stripLeadingV('1.2.0')).toBe('1.2.0');
  });
});

describe('fetchLatestRelease', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses a successful response into ReleaseInfo', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleRelease(),
    }) as typeof fetch;

    const release = await fetchLatestRelease();

    expect(release.tag).toBe('v1.3.0');
    expect(release.version).toBe('1.3.0');
    expect(release.tarballUrl).toBe(
      'https://github.com/stanrc85/tuck/releases/download/v1.3.0/tuck.tgz'
    );
    expect(release.htmlUrl).toContain('tag/v1.3.0');
  });

  it('returns tarballUrl=null when the tuck.tgz asset is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleRelease({ assets: [] }),
    }) as typeof fetch;

    const release = await fetchLatestRelease();
    expect(release.tarballUrl).toBeNull();
  });

  it('wraps network errors as UpdaterError with code=NETWORK', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')) as typeof fetch;

    await expect(fetchLatestRelease()).rejects.toMatchObject({
      name: 'UpdaterError',
      code: 'NETWORK',
    });
  });

  it('raises NOT_FOUND on HTTP 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as typeof fetch;

    await expect(fetchLatestRelease()).rejects.toMatchObject({
      name: 'UpdaterError',
      code: 'NOT_FOUND',
    });
  });

  it('raises RATE_LIMIT on HTTP 403/429', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    }) as typeof fetch;

    await expect(fetchLatestRelease()).rejects.toMatchObject({
      code: 'RATE_LIMIT',
    });
  });

  it('raises TIMEOUT when the request aborts', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    globalThis.fetch = vi.fn().mockRejectedValue(abortError) as typeof fetch;

    await expect(fetchLatestRelease()).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });
});

describe('fetchReleaseByTag', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('normalizes missing leading v and requests /tags/<tag>', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleRelease({ tag_name: 'v1.1.0' }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await fetchReleaseByTag('1.1.0');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/\/tags\/v1\.1\.0$/);
  });

  it('preserves an explicit leading v', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleRelease({ tag_name: 'v2.0.0' }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await fetchReleaseByTag('v2.0.0');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/\/tags\/v2\.0\.0$/);
  });

  it('surfaces NOT_FOUND for unknown tags', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    }) as typeof fetch;

    await expect(fetchReleaseByTag('v99.0.0')).rejects.toBeInstanceOf(UpdaterError);
    await expect(fetchReleaseByTag('v99.0.0')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('detectInstallOrigin', () => {
  const originalEnv = process.env.TUCK_SELF_UPDATE_ORIGIN;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.TUCK_SELF_UPDATE_ORIGIN;
    else process.env.TUCK_SELF_UPDATE_ORIGIN = originalEnv;
  });

  it('honors TUCK_SELF_UPDATE_ORIGIN=dev override', () => {
    process.env.TUCK_SELF_UPDATE_ORIGIN = 'dev';
    expect(detectInstallOrigin().kind).toBe('dev');
  });

  it('honors TUCK_SELF_UPDATE_ORIGIN=global override', () => {
    process.env.TUCK_SELF_UPDATE_ORIGIN = 'global';
    expect(detectInstallOrigin().kind).toBe('global');
  });

  it('falls back to global when no package root is found (e.g. mocked fs)', () => {
    delete process.env.TUCK_SELF_UPDATE_ORIGIN;
    // The global test setup mocks fs to an empty memfs volume, so the walk
    // up from updater.ts never finds a package.json. Detection must choose
    // the non-destructive path (global) rather than refusing the update.
    const origin = detectInstallOrigin();
    expect(origin.kind).toBe('global');
  });
});
