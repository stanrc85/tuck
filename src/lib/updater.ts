/**
 * Update checker for tuck CLI.
 *
 * The old `npm` auto-update path (via update-notifier against the upstream
 * `@prnv/tuck` package) is disabled on this fork — checking it from a fork
 * install would prompt users to "update" to upstream versions, which are
 * effectively downgrades compared to this fork's releases.
 *
 * Instead, this module queries GitHub Releases of `stanrc85/tuck` and powers
 * the `tuck self-update` command.
 */

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const GITHUB_OWNER = 'stanrc85';
export const GITHUB_REPO = 'tuck';
export const RELEASE_ASSET_NAME = 'tuck.tgz';

const RELEASES_API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = `tuck-cli (+https://github.com/${GITHUB_OWNER}/${GITHUB_REPO})`;

// ─────────────────────────────────────────────────────────────────────────────
// Legacy no-op (retained for src/index.ts preflight)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Background update check. Currently a no-op — auto-notification was disabled
 * to avoid "downgrade to upstream" prompts on fork installs. `tuck self-update`
 * is the explicit path.
 */
export const checkForUpdates = async (): Promise<void> => {
  return;
};

// ─────────────────────────────────────────────────────────────────────────────
// Release info
// ─────────────────────────────────────────────────────────────────────────────

export interface ReleaseInfo {
  /** Raw tag from GitHub (e.g. "v1.2.0"). */
  tag: string;
  /** Semver string without leading v (e.g. "1.2.0"). */
  version: string;
  /** Release display name. */
  name: string;
  /** ISO timestamp. */
  publishedAt: string;
  /** Browser download URL for the `tuck.tgz` asset, or null if absent. */
  tarballUrl: string | null;
  /** GitHub release page URL. */
  htmlUrl: string;
}

interface RawAsset {
  name: string;
  browser_download_url: string;
}

interface RawRelease {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  html_url: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: RawAsset[];
}

export class UpdaterError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NETWORK'
      | 'NOT_FOUND'
      | 'RATE_LIMIT'
      | 'TIMEOUT'
      | 'PARSE'
      | 'HTTP'
  ) {
    super(message);
    this.name = 'UpdaterError';
  }
}

const parseRelease = (raw: RawRelease): ReleaseInfo => {
  const tag = raw.tag_name;
  if (!tag) {
    throw new UpdaterError('Release payload missing tag_name', 'PARSE');
  }
  const asset = (raw.assets ?? []).find((a) => a.name === RELEASE_ASSET_NAME);
  return {
    tag,
    version: stripLeadingV(tag),
    name: raw.name || tag,
    publishedAt: raw.published_at ?? '',
    tarballUrl: asset ? asset.browser_download_url : null,
    htmlUrl: raw.html_url,
  };
};

const fetchJson = async (url: string): Promise<unknown> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UpdaterError(
        `Request to GitHub timed out after ${FETCH_TIMEOUT_MS / 1000}s`,
        'TIMEOUT'
      );
    }
    throw new UpdaterError(
      `Failed to reach GitHub: ${error instanceof Error ? error.message : String(error)}`,
      'NETWORK'
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) {
    throw new UpdaterError(`Release not found (404): ${url}`, 'NOT_FOUND');
  }
  if (response.status === 403 || response.status === 429) {
    throw new UpdaterError(
      `GitHub rate limit hit (HTTP ${response.status}). Try again later or set GITHUB_TOKEN.`,
      'RATE_LIMIT'
    );
  }
  if (!response.ok) {
    throw new UpdaterError(
      `GitHub returned HTTP ${response.status} for ${url}`,
      'HTTP'
    );
  }

  try {
    return await response.json();
  } catch (error) {
    throw new UpdaterError(
      `Could not parse GitHub response: ${error instanceof Error ? error.message : String(error)}`,
      'PARSE'
    );
  }
};

/**
 * Fetch the latest non-draft, non-prerelease release from the configured repo.
 * Uses `/releases/latest` which already filters drafts/prereleases server-side.
 */
export const fetchLatestRelease = async (): Promise<ReleaseInfo> => {
  const raw = (await fetchJson(`${RELEASES_API_BASE}/latest`)) as RawRelease;
  return parseRelease(raw);
};

/**
 * Fetch a specific release by tag (with or without leading `v`).
 */
export const fetchReleaseByTag = async (tag: string): Promise<ReleaseInfo> => {
  const normalized = tag.startsWith('v') ? tag : `v${tag}`;
  const raw = (await fetchJson(
    `${RELEASES_API_BASE}/tags/${encodeURIComponent(normalized)}`
  )) as RawRelease;
  return parseRelease(raw);
};

// ─────────────────────────────────────────────────────────────────────────────
// Version compare
// ─────────────────────────────────────────────────────────────────────────────

export const stripLeadingV = (tag: string): string =>
  tag.startsWith('v') || tag.startsWith('V') ? tag.slice(1) : tag;

/**
 * Compare two semver strings (ignoring pre-release suffixes). Leading `v` is
 * stripped. Returns negative if `a < b`, zero if equal, positive if `a > b`.
 * Non-numeric segments collapse to 0 so malformed input doesn't throw — the
 * caller has already validated anything it cares about.
 */
export const compareVersions = (a: string, b: string): number => {
  const normalize = (v: string): number[] => {
    const core = stripLeadingV(v).split(/[-+]/, 1)[0];
    return core.split('.').map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
  };
  const left = normalize(a);
  const right = normalize(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Install-origin detection
// ─────────────────────────────────────────────────────────────────────────────

export type InstallOrigin =
  | { kind: 'global'; packageRoot: string }
  | { kind: 'dev'; packageRoot: string };

/**
 * Resolve the install origin of the currently-running tuck binary.
 *
 * Heuristic: starting from this module's on-disk location, walk up until we
 * find a directory containing `package.json`. That directory is the package
 * root. If it contains a `src/` subdirectory (which `files` in package.json
 * excludes from published tarballs), it's a dev clone; otherwise it's an
 * installed package — global or via the release tarball.
 *
 * `TUCK_SELF_UPDATE_ORIGIN` overrides detection for tests / escape hatches:
 * set to `global` or `dev`.
 */
export const detectInstallOrigin = (): InstallOrigin => {
  const override = process.env.TUCK_SELF_UPDATE_ORIGIN;
  if (override === 'global' || override === 'dev') {
    return { kind: override, packageRoot: findPackageRoot() ?? process.cwd() };
  }

  const packageRoot = findPackageRoot();
  if (!packageRoot) {
    // Fall back to treating as global — self-update will still attempt
    // `npm install -g` and npm will surface any real issue.
    return { kind: 'global', packageRoot: process.cwd() };
  }

  const isDev = existsSync(join(packageRoot, 'src'));
  return { kind: isDev ? 'dev' : 'global', packageRoot };
};

const findPackageRoot = (): string | null => {
  try {
    // When bundled by tsup, import.meta.url points inside dist/; when running
    // source via ts-node, it points inside src/. Either way, walking up lands
    // on the package root eventually.
    const start = dirname(fileURLToPath(import.meta.url));
    let current = start;
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(current, 'package.json'))) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
    // import.meta.url not resolvable in some bundler contexts — fall through.
  }
  return null;
};
