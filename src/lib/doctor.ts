import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { CONFIG_FILE } from '../constants.js';
import type { TuckConfigOutput } from '../schemas/config.schema.js';
import type { TuckManifestOutput } from '../schemas/manifest.schema.js';
import { loadConfig } from './config.js';
import { getStatus } from './git.js';
import { loadManifest } from './manifest.js';
import { detectInstallOrigin } from './updater.js';
import {
  collapsePath,
  expandPath,
  getConfigPath,
  getManifestPath,
  getTuckDir,
  isDirectory,
  pathExists,
  validatePathWithinRoot,
  validateSafeManifestDestination,
  validateSafeSourcePath,
} from './paths.js';

const execFileAsync = promisify(execFile);

export const DOCTOR_CATEGORIES = ['env', 'repo', 'manifest', 'security', 'hooks'] as const;

export type DoctorCategory = (typeof DOCTOR_CATEGORIES)[number];
export type DoctorStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheckResult {
  id: string;
  category: DoctorCategory;
  status: DoctorStatus;
  message: string;
  details?: string;
  fix?: string;
}

export interface DoctorSummary {
  passed: number;
  warnings: number;
  failed: number;
}

export interface DoctorReport {
  generatedAt: string;
  tuckDir: string;
  summary: DoctorSummary;
  checks: DoctorCheckResult[];
}

export interface DoctorRunOptions {
  category?: DoctorCategory;
}

interface DoctorContext {
  tuckDir: string;
  manifestPath: string;
  configPath: string;
  hasTuckDir: boolean;
  isTuckDirDirectory: boolean;
  hasGitDir: boolean;
  hasManifestFile: boolean;
  hasConfigFile: boolean;
  manifestLoadError?: string;
  configLoadError?: string;
  manifest?: TuckManifestOutput;
  config?: TuckConfigOutput;
}

interface DoctorCheck {
  id: string;
  category: DoctorCategory;
  run: (context: DoctorContext) => Promise<DoctorCheckResult>;
}

const checkNodeVersion: DoctorCheck = {
  id: 'env.node-version',
  category: 'env',
  run: async () => {
    const major = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);
    if (major >= 18) {
      return {
        id: 'env.node-version',
        category: 'env',
        status: 'pass',
        message: `Node.js ${process.versions.node} is supported`,
      };
    }

    return {
      id: 'env.node-version',
      category: 'env',
      status: 'fail',
      message: `Node.js ${process.versions.node} is unsupported`,
      fix: 'Upgrade Node.js to version 18 or newer',
    };
  },
};

const checkTtyCapability: DoctorCheck = {
  id: 'env.tty-capability',
  category: 'env',
  run: async () => {
    const stdoutTty = Boolean(process.stdout.isTTY);
    const stdinTty = Boolean(process.stdin.isTTY);
    const nonInteractiveEnv = process.env.TUCK_NON_INTERACTIVE;
    const nonInteractive = nonInteractiveEnv === '1' || nonInteractiveEnv === 'true';
    const term = process.env.TERM ?? '';
    const noColor = process.env.NO_COLOR !== undefined;

    const envDetails = [
      `stdin.isTTY=${stdinTty}`,
      `stdout.isTTY=${stdoutTty}`,
      `TUCK_NON_INTERACTIVE=${nonInteractiveEnv ?? '<unset>'}`,
      `TERM=${term || '<unset>'}`,
      `NO_COLOR=${noColor ? '<set>' : '<unset>'}`,
    ].join(' ');

    if (nonInteractive) {
      return {
        id: 'env.tty-capability',
        category: 'env',
        status: 'pass',
        message: 'Non-interactive mode forced via TUCK_NON_INTERACTIVE',
        details: envDetails,
      };
    }

    if (stdoutTty && stdinTty) {
      return {
        id: 'env.tty-capability',
        category: 'env',
        status: 'pass',
        message: 'Interactive TTY detected on stdin and stdout',
        details: envDetails,
      };
    }

    if (!stdoutTty && !stdinTty) {
      return {
        id: 'env.tty-capability',
        category: 'env',
        status: 'pass',
        message: 'Non-interactive shell — tuck will use its plain-log fallback',
        details: envDetails,
      };
    }

    // Mixed state: the dangerous middle ground. @clack/prompts can open a
    // readline on whichever side is a TTY and wait forever for keypresses the
    // user can't see (e.g. stdout redirected to a log file).
    const tty = stdoutTty ? 'stdout' : 'stdin';
    const nonTty = stdoutTty ? 'stdin' : 'stdout';
    return {
      id: 'env.tty-capability',
      category: 'env',
      status: 'warn',
      message: `Mixed TTY state — ${tty} is a TTY but ${nonTty} is not`,
      details: envDetails,
      fix: 'Interactive prompts may hang. Set TUCK_NON_INTERACTIVE=1 to force the plain-log fallback, or run inside a real terminal (e.g. `script -qc "..." /dev/null`).',
    };
  },
};

/**
 * pnpm is only needed when building tuck from source — an end-user running
 * a published tarball install has no use for it. Skip the check entirely on
 * global installs (reported as `pass` with "not applicable" so users see the
 * check ran), warn on dev clones where pnpm is missing.
 */
const checkPnpmAvailability: DoctorCheck = {
  id: 'env.pnpm-availability',
  category: 'env',
  run: async () => {
    const origin = detectInstallOrigin();
    if (origin.kind === 'global') {
      return {
        id: 'env.pnpm-availability',
        category: 'env',
        status: 'pass',
        message: 'pnpm check not applicable — running from a global install',
      };
    }

    const isWindows = process.platform === 'win32';
    try {
      const { stdout } = await execFileAsync(isWindows ? 'pnpm.cmd' : 'pnpm', ['--version'], {
        timeout: 5000,
        shell: isWindows,
      });
      return {
        id: 'env.pnpm-availability',
        category: 'env',
        status: 'pass',
        message: `pnpm ${stdout.trim()} is available`,
      };
    } catch {
      return {
        id: 'env.pnpm-availability',
        category: 'env',
        status: 'warn',
        message: 'pnpm is not on PATH — build/lint/test scripts will fail',
        fix: 'Install pnpm (`npm i -g pnpm` or see https://pnpm.io/installation). pnpm is only needed when building tuck from source.',
      };
    }
  },
};

/**
 * `tuck apply <github-user>` and token credential storage lean on the GitHub
 * CLI when available. Check is gated to `remote.mode === 'github'` — skipping
 * entirely (with a pass result so it still appears in the report) for local,
 * gitlab, or custom providers where gh is irrelevant.
 */
const checkGhCliAvailability: DoctorCheck = {
  id: 'env.gh-cli-availability',
  category: 'env',
  run: async (context) => {
    if (!context.config || context.config.remote?.mode !== 'github') {
      return {
        id: 'env.gh-cli-availability',
        category: 'env',
        status: 'pass',
        message: 'gh CLI check not applicable — remote provider is not GitHub',
      };
    }

    try {
      await execFileAsync('gh', ['--version'], { timeout: 2000 });
    } catch {
      return {
        id: 'env.gh-cli-availability',
        category: 'env',
        status: 'warn',
        message: 'GitHub CLI (`gh`) is not installed',
        fix: 'Install gh (https://cli.github.com/) — without it, `tuck apply <user>` won\'t resolve private repos and token setup falls back to manual paste. Tuck works without gh for public repos + SSH/token auth already stored.',
      };
    }

    try {
      await execFileAsync('gh', ['auth', 'status'], { timeout: 3000 });
      return {
        id: 'env.gh-cli-availability',
        category: 'env',
        status: 'pass',
        message: 'GitHub CLI is installed and authenticated',
      };
    } catch {
      return {
        id: 'env.gh-cli-availability',
        category: 'env',
        status: 'warn',
        message: 'GitHub CLI is installed but not authenticated',
        fix: 'Run `gh auth login` — without auth, gh-dependent code paths (auto-detect existing repos, private clones) fall back to manual flows.',
      };
    }
  },
};

const checkHomeDirectory: DoctorCheck = {
  id: 'env.home-directory',
  category: 'env',
  run: async () => {
    const home = homedir();
    if (!home || home.trim().length === 0) {
      return {
        id: 'env.home-directory',
        category: 'env',
        status: 'fail',
        message: 'Home directory could not be resolved',
        fix: 'Ensure the current OS user account has a valid home directory',
      };
    }

    return {
      id: 'env.home-directory',
      category: 'env',
      status: 'pass',
      message: `Home directory resolved: ${collapsePath(home)}`,
    };
  },
};

const checkTuckDirectory: DoctorCheck = {
  id: 'repo.tuck-directory',
  category: 'repo',
  run: async (context) => {
    if (context.hasTuckDir && context.isTuckDirDirectory) {
      return {
        id: 'repo.tuck-directory',
        category: 'repo',
        status: 'pass',
        message: `Tuck directory exists: ${collapsePath(context.tuckDir)}`,
      };
    }

    if (context.hasTuckDir && !context.isTuckDirDirectory) {
      return {
        id: 'repo.tuck-directory',
        category: 'repo',
        status: 'fail',
        message: `Tuck path is not a directory: ${collapsePath(context.tuckDir)}`,
        fix: 'Remove or rename the conflicting file, then run `tuck init`',
      };
    }

    return {
      id: 'repo.tuck-directory',
      category: 'repo',
      status: 'fail',
      message: `Tuck directory missing: ${collapsePath(context.tuckDir)}`,
      fix: 'Run `tuck init` to initialize this machine',
    };
  },
};

const checkGitDirectory: DoctorCheck = {
  id: 'repo.git-directory',
  category: 'repo',
  run: async (context) => {
    if (!context.hasTuckDir) {
      return {
        id: 'repo.git-directory',
        category: 'repo',
        status: 'warn',
        message: 'Skipped git checks because tuck is not initialized',
      };
    }

    if (context.hasGitDir) {
      return {
        id: 'repo.git-directory',
        category: 'repo',
        status: 'pass',
        message: 'Git metadata is present in tuck directory',
      };
    }

    return {
      id: 'repo.git-directory',
      category: 'repo',
      status: 'fail',
      message: 'Missing .git directory under tuck repository',
      fix: 'Reinitialize with `tuck init` or restore the git metadata',
    };
  },
};

const checkGitStatusReadable: DoctorCheck = {
  id: 'repo.git-status',
  category: 'repo',
  run: async (context) => {
    if (!context.hasTuckDir || !context.hasGitDir) {
      return {
        id: 'repo.git-status',
        category: 'repo',
        status: 'warn',
        message: 'Skipped git status check because repository is unavailable',
      };
    }

    try {
      await getStatus(context.tuckDir);
      return {
        id: 'repo.git-status',
        category: 'repo',
        status: 'pass',
        message: 'Git status can be read successfully',
      };
    } catch (error) {
      return {
        id: 'repo.git-status',
        category: 'repo',
        status: 'fail',
        message: 'Failed to read git status',
        details: error instanceof Error ? error.message : String(error),
        fix: 'Run `git status` inside the tuck directory and resolve repository errors',
      };
    }
  },
};

const checkBranchTracking: DoctorCheck = {
  id: 'repo.branch-tracking',
  category: 'repo',
  run: async (context) => {
    if (!context.hasTuckDir || !context.hasGitDir) {
      return {
        id: 'repo.branch-tracking',
        category: 'repo',
        status: 'warn',
        message: 'Skipped branch-tracking check because repository is unavailable',
      };
    }

    let status;
    try {
      status = await getStatus(context.tuckDir);
    } catch {
      // checkGitStatusReadable already surfaces the underlying failure — don't
      // double-fail on the same root cause.
      return {
        id: 'repo.branch-tracking',
        category: 'repo',
        status: 'warn',
        message: 'Skipped branch-tracking check because git status could not be read',
      };
    }

    if (!status.tracking) {
      return {
        id: 'repo.branch-tracking',
        category: 'repo',
        status: 'warn',
        message: `Branch '${status.branch}' has no upstream configured`,
        fix: `Run \`tuck push --set-upstream origin ${status.branch}\` to publish and track, or set one with \`git branch --set-upstream-to=<remote>/<branch>\``,
      };
    }

    if (status.behind > 0 && status.ahead > 0) {
      return {
        id: 'repo.branch-tracking',
        category: 'repo',
        status: 'warn',
        message: `Branch '${status.branch}' has diverged from '${status.tracking}' (${status.ahead} ahead, ${status.behind} behind)`,
        fix: 'Run `tuck pull` (rebase or merge) to reconcile before pushing',
      };
    }

    if (status.behind > 0) {
      return {
        id: 'repo.branch-tracking',
        category: 'repo',
        status: 'warn',
        message: `Branch '${status.branch}' is ${status.behind} commit${status.behind === 1 ? '' : 's'} behind '${status.tracking}'`,
        fix: 'Run `tuck pull` before making further changes',
      };
    }

    if (status.ahead > 0) {
      return {
        id: 'repo.branch-tracking',
        category: 'repo',
        status: 'pass',
        message: `Branch '${status.branch}' is ${status.ahead} commit${status.ahead === 1 ? '' : 's'} ahead of '${status.tracking}'`,
        details: 'Run `tuck push` to publish local commits',
      };
    }

    return {
      id: 'repo.branch-tracking',
      category: 'repo',
      status: 'pass',
      message: `Branch '${status.branch}' is up to date with '${status.tracking}'`,
    };
  },
};

const checkManifestLoadable: DoctorCheck = {
  id: 'repo.manifest-loadable',
  category: 'repo',
  run: async (context) => {
    if (!context.hasTuckDir) {
      return {
        id: 'repo.manifest-loadable',
        category: 'repo',
        status: 'warn',
        message: 'Skipped manifest load check because tuck is not initialized',
      };
    }

    if (!context.hasManifestFile) {
      return {
        id: 'repo.manifest-loadable',
        category: 'repo',
        status: 'fail',
        message: `Manifest missing: ${collapsePath(context.manifestPath)}`,
        fix: 'Recreate with `tuck init` or restore `.tuckmanifest.json` from backup',
      };
    }

    if (context.manifest) {
      return {
        id: 'repo.manifest-loadable',
        category: 'repo',
        status: 'pass',
        message: 'Manifest is present and valid',
      };
    }

    return {
      id: 'repo.manifest-loadable',
      category: 'repo',
      status: 'fail',
      message: 'Manifest exists but failed to parse',
      details: context.manifestLoadError,
      fix: 'Repair `.tuckmanifest.json` using a valid schema or restore from git',
    };
  },
};

const checkConfigLoadable: DoctorCheck = {
  id: 'repo.config-loadable',
  category: 'repo',
  run: async (context) => {
    if (!context.hasTuckDir) {
      return {
        id: 'repo.config-loadable',
        category: 'repo',
        status: 'warn',
        message: 'Skipped config load check because tuck is not initialized',
      };
    }

    if (!context.hasConfigFile) {
      return {
        id: 'repo.config-loadable',
        category: 'repo',
        status: 'warn',
        message: `Config file missing: ${collapsePath(context.configPath)} (defaults will be used)`,
        fix: 'Run `tuck config reset` to generate a config file with defaults',
      };
    }

    if (context.config) {
      return {
        id: 'repo.config-loadable',
        category: 'repo',
        status: 'pass',
        message: 'Configuration is present and valid',
      };
    }

    return {
      id: 'repo.config-loadable',
      category: 'repo',
      status: 'fail',
      message: 'Configuration exists but failed to parse',
      details: context.configLoadError,
      fix: 'Repair `.tuckrc.json` or run `tuck config reset`',
    };
  },
};

/**
 * Catches the v1 → v2 migration landmine from TASK-033: `defaultGroups` is a
 * per-host value, but v1 wrote it into the shared `.tuckrc.json` which gets
 * committed and pushed by `tuck sync`, then pulled onto other hosts, making
 * every machine think it belongs to the first host's groups.
 *
 * Reads the RAW shared config (not the merged view — merged would hide a
 * legitimately-migrated host where local override masks the leaked shared
 * value). Warns only when the shared file has a non-empty `defaultGroups`
 * AND is tracked in git (an untracked file can't leak).
 */
const checkLegacyDefaultGroups: DoctorCheck = {
  id: 'repo.legacy-default-groups',
  category: 'repo',
  run: async (context) => {
    if (!context.hasTuckDir || !context.hasConfigFile) {
      return {
        id: 'repo.legacy-default-groups',
        category: 'repo',
        status: 'pass',
        message: 'No shared config present — nothing to check',
      };
    }

    let raw: unknown;
    try {
      const content = await readFile(context.configPath, 'utf-8');
      raw = JSON.parse(content);
    } catch {
      // A broken .tuckrc.json is already surfaced by checkConfigLoadable; don't
      // double-report. Pass here so we don't drown the user in two errors for
      // the same underlying issue.
      return {
        id: 'repo.legacy-default-groups',
        category: 'repo',
        status: 'pass',
        message: 'Skipped — shared config could not be read',
      };
    }

    const rawObj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
    const defaultGroups = rawObj?.defaultGroups;
    const hasLeak = Array.isArray(defaultGroups) && defaultGroups.length > 0;

    if (!hasLeak) {
      return {
        id: 'repo.legacy-default-groups',
        category: 'repo',
        status: 'pass',
        message: 'No legacy `defaultGroups` in shared config',
      };
    }

    // Non-empty defaultGroups in shared config. Now check whether the file is
    // tracked in git — if it's untracked, the value won't propagate on sync.
    let tracked = false;
    try {
      const { stdout } = await execFileAsync('git', ['ls-files', '--', CONFIG_FILE], {
        cwd: context.tuckDir,
      });
      tracked = stdout.trim().length > 0;
    } catch {
      // Git missing / not a repo / read error — can't confirm propagation risk.
      // Err toward warning: the leak is still present in the working copy and
      // will bite the moment git comes back online or sync runs.
      tracked = true;
    }

    const groupsList = (defaultGroups as string[]).map((g) => `"${g}"`).join(', ');

    if (!tracked) {
      return {
        id: 'repo.legacy-default-groups',
        category: 'repo',
        status: 'warn',
        message:
          '`defaultGroups` is set in the shared `.tuckrc.json` (not tracked in git) — still better to move it to `.tuckrc.local.json` so future `git add` runs don\'t reintroduce the leak',
        details: `defaultGroups = [${groupsList}]`,
        fix: 'Move `defaultGroups` to `~/.tuck/.tuckrc.local.json` (gitignored) and remove it from `.tuckrc.json`. See README "Host Groups > Defaults" for the one-shot steps.',
      };
    }

    return {
      id: 'repo.legacy-default-groups',
      category: 'repo',
      status: 'warn',
      message:
        '`defaultGroups` is set in the shared `.tuckrc.json` AND is tracked in git — this leaks per-host config across machines on every `tuck sync`',
      details: `defaultGroups = [${groupsList}] (value propagates to every host that pulls the shared repo)`,
      fix: 'Move `defaultGroups` to `~/.tuck/.tuckrc.local.json` (gitignored) and remove it from the shared file, then commit + push the shared edit once. See README "Host Groups > Defaults" for the exact shell steps.',
    };
  },
};

const checkManifestPathSafety: DoctorCheck = {
  id: 'manifest.path-safety',
  category: 'manifest',
  run: async (context) => {
    if (!context.manifest) {
      return {
        id: 'manifest.path-safety',
        category: 'manifest',
        status: 'warn',
        message: 'Skipped manifest path checks because manifest is unavailable',
      };
    }

    const violations: string[] = [];
    for (const [id, file] of Object.entries(context.manifest.files)) {
      try {
        validateSafeSourcePath(file.source);
      } catch (error) {
        violations.push(`${id}: unsafe source ${file.source} (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }

      try {
        validateSafeManifestDestination(file.destination);
      } catch (error) {
        violations.push(
          `${id}: unsafe destination ${file.destination} (${error instanceof Error ? error.message : String(error)})`
        );
        continue;
      }

      try {
        validatePathWithinRoot(join(context.tuckDir, file.destination), context.tuckDir, 'manifest destination');
      } catch (error) {
        violations.push(
          `${id}: destination escapes tuck dir (${error instanceof Error ? error.message : String(error)})`
        );
      }
    }

    if (violations.length === 0) {
      return {
        id: 'manifest.path-safety',
        category: 'manifest',
        status: 'pass',
        message: 'All manifest paths are safe',
      };
    }

    return {
      id: 'manifest.path-safety',
      category: 'manifest',
      status: 'fail',
      message: `Detected ${violations.length} unsafe manifest path entr${violations.length === 1 ? 'y' : 'ies'}`,
      details: violations.slice(0, 3).join('; '),
      fix: 'Replace unsafe paths with home-scoped sources and `files/...` destinations',
    };
  },
};

const checkManifestDuplicateSources: DoctorCheck = {
  id: 'manifest.duplicate-sources',
  category: 'manifest',
  run: async (context) => {
    if (!context.manifest) {
      return {
        id: 'manifest.duplicate-sources',
        category: 'manifest',
        status: 'warn',
        message: 'Skipped duplicate source checks because manifest is unavailable',
      };
    }

    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const file of Object.values(context.manifest.files)) {
      const normalized = expandPath(file.source);
      if (seen.has(normalized)) {
        duplicates.push(file.source);
      }
      seen.add(normalized);
    }

    if (duplicates.length === 0) {
      return {
        id: 'manifest.duplicate-sources',
        category: 'manifest',
        status: 'pass',
        message: 'No duplicate source paths detected',
      };
    }

    return {
      id: 'manifest.duplicate-sources',
      category: 'manifest',
      status: 'fail',
      message: `Detected duplicate source paths (${duplicates.length})`,
      details: duplicates.slice(0, 5).join(', '),
      fix: 'Keep each source path tracked exactly once in `.tuckmanifest.json`',
    };
  },
};

const checkManifestDuplicateDestinations: DoctorCheck = {
  id: 'manifest.duplicate-destinations',
  category: 'manifest',
  run: async (context) => {
    if (!context.manifest) {
      return {
        id: 'manifest.duplicate-destinations',
        category: 'manifest',
        status: 'warn',
        message: 'Skipped duplicate destination checks because manifest is unavailable',
      };
    }

    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const file of Object.values(context.manifest.files)) {
      const normalized = file.destination.replace(/\\/g, '/');
      if (seen.has(normalized)) {
        duplicates.push(file.destination);
      }
      seen.add(normalized);
    }

    if (duplicates.length === 0) {
      return {
        id: 'manifest.duplicate-destinations',
        category: 'manifest',
        status: 'pass',
        message: 'No duplicate repository destinations detected',
      };
    }

    return {
      id: 'manifest.duplicate-destinations',
      category: 'manifest',
      status: 'fail',
      message: `Detected duplicate destinations (${duplicates.length})`,
      details: duplicates.slice(0, 5).join(', '),
      fix: 'Assign each tracked file a unique destination under `files/`',
    };
  },
};

const checkSecretScanning: DoctorCheck = {
  id: 'security.secret-scanning',
  category: 'security',
  run: async (context) => {
    if (!context.config) {
      return {
        id: 'security.secret-scanning',
        category: 'security',
        status: 'warn',
        message: 'Skipped secret scanning checks because config is unavailable',
      };
    }

    if (!context.config.security.scanSecrets) {
      return {
        id: 'security.secret-scanning',
        category: 'security',
        status: 'warn',
        message: 'Secret scanning is disabled',
        fix: 'Enable with `tuck config set security.scanSecrets true`',
      };
    }

    return {
      id: 'security.secret-scanning',
      category: 'security',
      status: 'pass',
      message: 'Secret scanning is enabled',
    };
  },
};

const checkBackupOnRestore: DoctorCheck = {
  id: 'security.backup-on-restore',
  category: 'security',
  run: async (context) => {
    if (!context.config) {
      return {
        id: 'security.backup-on-restore',
        category: 'security',
        status: 'warn',
        message: 'Skipped backup checks because config is unavailable',
      };
    }

    if (!context.config.files.backupOnRestore) {
      return {
        id: 'security.backup-on-restore',
        category: 'security',
        status: 'warn',
        message: 'Backup before restore is disabled',
        fix: 'Enable with `tuck config set files.backupOnRestore true`',
      };
    }

    return {
      id: 'security.backup-on-restore',
      category: 'security',
      status: 'pass',
      message: 'Backup before restore is enabled',
    };
  },
};

const checkHooksSafety: DoctorCheck = {
  id: 'hooks.commands',
  category: 'hooks',
  run: async (context) => {
    if (!context.config) {
      return {
        id: 'hooks.commands',
        category: 'hooks',
        status: 'warn',
        message: 'Skipped hook checks because config is unavailable',
      };
    }

    const hooks = context.config.hooks;
    const configuredHooks = Object.entries(hooks).filter(
      ([, command]) => typeof command === 'string' && command.trim().length > 0
    );

    if (configuredHooks.length === 0) {
      return {
        id: 'hooks.commands',
        category: 'hooks',
        status: 'pass',
        message: 'No lifecycle hooks configured',
      };
    }

    const suspiciousPatterns = [/&&/u, /\|\|/u, /;{1}/u, /\$\(/u, /`/u];
    const suspicious = configuredHooks.filter(([, command]) =>
      suspiciousPatterns.some((pattern) => pattern.test(command as string))
    );

    if (suspicious.length > 0) {
      return {
        id: 'hooks.commands',
        category: 'hooks',
        status: 'warn',
        message: `Detected ${suspicious.length} hook command${suspicious.length === 1 ? '' : 's'} with complex shell syntax`,
        details: suspicious.map(([name]) => name).join(', '),
        fix: 'Review hook commands and keep them minimal and auditable',
      };
    }

    return {
      id: 'hooks.commands',
      category: 'hooks',
      status: 'pass',
      message: `Validated ${configuredHooks.length} hook command${configuredHooks.length === 1 ? '' : 's'}`,
    };
  },
};

/**
 * Visibility into the hooks trust model. `trustHooks` is a per-invocation
 * flag (`--trust-hooks` / programmatic option), not a persistent config
 * field, so a config-based check can't read a stored value — the plan
 * originally called for that and was reframed in TASK-029. Instead: when
 * any hook is configured, surface the fact that `--trust-hooks` + scripted
 * runs bypass the confirmation prompt. No hooks → silent pass.
 */
const checkHooksTrustModel: DoctorCheck = {
  id: 'hooks.trust-model',
  category: 'hooks',
  run: async (context) => {
    if (!context.config) {
      return {
        id: 'hooks.trust-model',
        category: 'hooks',
        status: 'warn',
        message: 'Skipped hook trust-model check because config is unavailable',
      };
    }

    const hooks = context.config.hooks;
    const configuredHooks = Object.entries(hooks).filter(
      ([, command]) => typeof command === 'string' && command.trim().length > 0
    );

    if (configuredHooks.length === 0) {
      return {
        id: 'hooks.trust-model',
        category: 'hooks',
        status: 'pass',
        message: 'No hooks configured — trust model not engaged',
      };
    }

    const names = configuredHooks.map(([name]) => name).join(', ');
    return {
      id: 'hooks.trust-model',
      category: 'hooks',
      status: 'warn',
      message: `${configuredHooks.length} hook${configuredHooks.length === 1 ? '' : 's'} configured — interactive prompts guard execution, but \`--trust-hooks\` and non-TTY runs bypass them`,
      details: `configured: ${names}`,
      fix: 'Review each command for safety. In CI / scripts, only pass `--trust-hooks` when you control the hook source. Remove hooks you don\'t actively need.',
    };
  },
};

const doctorChecks: DoctorCheck[] = [
  checkNodeVersion,
  checkTtyCapability,
  checkPnpmAvailability,
  checkGhCliAvailability,
  checkHomeDirectory,
  checkTuckDirectory,
  checkGitDirectory,
  checkGitStatusReadable,
  checkBranchTracking,
  checkManifestLoadable,
  checkConfigLoadable,
  checkLegacyDefaultGroups,
  checkManifestPathSafety,
  checkManifestDuplicateSources,
  checkManifestDuplicateDestinations,
  checkSecretScanning,
  checkBackupOnRestore,
  checkHooksSafety,
  checkHooksTrustModel,
];

const buildDoctorSummary = (checks: DoctorCheckResult[]): DoctorSummary => {
  return checks.reduce<DoctorSummary>(
    (summary, check) => {
      if (check.status === 'pass') {
        summary.passed += 1;
      } else if (check.status === 'warn') {
        summary.warnings += 1;
      } else {
        summary.failed += 1;
      }
      return summary;
    },
    {
      passed: 0,
      warnings: 0,
      failed: 0,
    }
  );
};

const buildDoctorContext = async (): Promise<DoctorContext> => {
  const tuckDir = getTuckDir();
  const manifestPath = getManifestPath(tuckDir);
  const configPath = getConfigPath(tuckDir);
  const hasTuckDir = await pathExists(tuckDir);
  const isTuckDirDirectory = hasTuckDir ? await isDirectory(tuckDir) : false;
  const hasGitDir = await pathExists(join(tuckDir, '.git'));
  const hasManifestFile = await pathExists(manifestPath);
  const hasConfigFile = await pathExists(configPath);

  const context: DoctorContext = {
    tuckDir,
    manifestPath,
    configPath,
    hasTuckDir,
    isTuckDirDirectory,
    hasGitDir,
    hasManifestFile,
    hasConfigFile,
  };

  if (hasManifestFile) {
    try {
      context.manifest = await loadManifest(tuckDir);
    } catch (error) {
      context.manifestLoadError = error instanceof Error ? error.message : String(error);
    }
  }

  if (hasConfigFile) {
    try {
      context.config = await loadConfig(tuckDir);
    } catch (error) {
      context.configLoadError = error instanceof Error ? error.message : String(error);
    }
  }

  return context;
};

const normalizeCategory = (category?: string): DoctorCategory | undefined => {
  if (!category) {
    return undefined;
  }

  if ((DOCTOR_CATEGORIES as readonly string[]).includes(category)) {
    return category as DoctorCategory;
  }

  return undefined;
};

export const runDoctorChecks = async (options: DoctorRunOptions = {}): Promise<DoctorReport> => {
  const context = await buildDoctorContext();
  const category = normalizeCategory(options.category);
  const selectedChecks = category
    ? doctorChecks.filter((check) => check.category === category)
    : doctorChecks;

  const checks: DoctorCheckResult[] = [];
  for (const check of selectedChecks) {
    try {
      checks.push(await check.run(context));
    } catch (error) {
      checks.push({
        id: check.id,
        category: check.category,
        status: 'fail',
        message: 'Doctor check crashed unexpectedly',
        details: error instanceof Error ? error.message : String(error),
        fix: 'Run with DEBUG=1 and inspect the stack trace',
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    tuckDir: context.tuckDir,
    summary: buildDoctorSummary(checks),
    checks,
  };
};

export const getDoctorExitCode = (report: DoctorReport, strict = false): number => {
  if (report.summary.failed > 0) {
    return 1;
  }

  if (strict && report.summary.warnings > 0) {
    return 2;
  }

  return 0;
};
