import { arch as osArch, platform as osPlatform, homedir } from 'os';
import { getTuckDir } from '../paths.js';
import { BootstrapError } from '../../errors.js';

/**
 * Variable substitution for `bootstrap.toml` strings.
 *
 * Supports exactly five tokens (`${VERSION}`, `${ARCH}`, `${HOME}`, `${OS}`,
 * `${TUCK_DIR}`). Any other `${...}` sequence passes through unchanged so
 * that shell variables referenced by install scripts (e.g. `${PATH}`) still
 * expand at shell-execution time.
 *
 * This is deliberately not a general-purpose templater: no `$()`, no
 * arbitrary env-var reach-through, no conditionals. Keeping it narrow means
 * a `bootstrap.toml` can't exfiltrate env secrets via the interpolation
 * layer — anything beyond the five tokens is the shell's problem.
 */

const KNOWN_VARS = ['VERSION', 'ARCH', 'HOME', 'OS', 'TUCK_DIR'] as const;
export type BootstrapVarName = (typeof KNOWN_VARS)[number];

export interface BootstrapVars {
  /** From `tool.version`. May be absent for version-less tools. */
  VERSION?: string;
  /** Normalized CPU arch: amd64, arm64, armhf, or node's raw value. */
  ARCH: string;
  /** User home directory. */
  HOME: string;
  /** Normalized OS: linux, darwin, windows, or node's raw value. */
  OS: string;
  /** Absolute path to the tuck data directory. */
  TUCK_DIR: string;
}

const VAR_PATTERN = new RegExp(`\\$\\{(${KNOWN_VARS.join('|')})\\}`, 'g');

/**
 * Map Node's `os.arch()` to the Debian-style names the ticket requires
 * (`amd64`/`arm64`/`armhf`). Unknown archs pass through so uncommon
 * platforms still have a chance of working without a code change.
 */
const normalizeArch = (raw: string): string => {
  switch (raw) {
    case 'x64':
      return 'amd64';
    case 'arm64':
      return 'arm64';
    case 'arm':
      return 'armhf';
    default:
      return raw;
  }
};

/**
 * Map Node's `os.platform()` to the conventional short names used in
 * download URLs and package filenames (`linux`, `darwin`, `windows`).
 */
const normalizeOs = (raw: string): string => {
  switch (raw) {
    case 'win32':
      return 'windows';
    default:
      return raw;
  }
};

/**
 * Detect the four platform-derived variables. `VERSION` is per-tool and
 * must be supplied by the caller. `TUCK_DIR` defers to `getTuckDir()` so
 * `TUCK_DIR` env overrides are honored.
 */
export const detectPlatformVars = (): Omit<BootstrapVars, 'VERSION'> => ({
  ARCH: normalizeArch(osArch()),
  HOME: homedir(),
  OS: normalizeOs(osPlatform()),
  TUCK_DIR: getTuckDir(),
});

/**
 * Replace every known `${VAR}` in `template` with the matching value.
 * Throws `BootstrapError` if a known token is referenced but its value is
 * undefined (the only realistic case is `${VERSION}` on a tool without a
 * `version` field — an authoring bug worth failing loudly for).
 */
export const interpolate = (template: string, vars: BootstrapVars): string => {
  return template.replace(VAR_PATTERN, (_match, name: BootstrapVarName) => {
    const value = vars[name];
    if (value === undefined) {
      throw new BootstrapError(
        `Template references \${${name}} but no value is available`,
        name === 'VERSION'
          ? ['Add a `version = "..."` field to the tool definition']
          : [`Could not determine ${name} for this platform`]
      );
    }
    return value;
  });
};
