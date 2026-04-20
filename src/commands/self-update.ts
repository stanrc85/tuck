import { Command } from 'commander';
import { spawn } from 'child_process';
import {
  prompts,
  logger,
  isInteractive,
  colors as c,
} from '../ui/index.js';
import { VERSION } from '../constants.js';
import {
  compareVersions,
  detectInstallOrigin,
  fetchLatestRelease,
  fetchReleaseByTag,
  GITHUB_OWNER,
  GITHUB_REPO,
  RELEASE_ASSET_NAME,
  UpdaterError,
  type ReleaseInfo,
} from '../lib/updater.js';
import { TuckError, NonInteractivePromptError } from '../errors.js';

interface SelfUpdateOptions {
  check?: boolean;
  yes?: boolean;
  /** Specific release tag to pin to (`--tag <tag>`). */
  tag?: string;
}

const runningAsRoot = (): boolean => {
  // getuid is POSIX-only; undefined on Windows, where admin installs don't
  // need a privilege-escalation wrapper.
  return typeof process.getuid === 'function' && process.getuid() === 0;
};

/**
 * Resolve the install command. Global installs run
 *   npm install -g <tarball-url>
 * on Windows / when already root, and
 *   sudo npm install -g <tarball-url>
 * otherwise. POSIX non-root installs need sudo because global npm prefixes are
 * usually root-owned (/usr/lib/node_modules, /usr/local/lib/node_modules, …).
 */
const buildInstallCommand = (tarballUrl: string): { cmd: string; args: string[] } => {
  const npmArgs = ['install', '-g', tarballUrl];
  if (process.platform === 'win32' || runningAsRoot()) {
    return { cmd: 'npm', args: npmArgs };
  }
  return { cmd: 'sudo', args: ['npm', ...npmArgs] };
};

const runInstall = async (tarballUrl: string): Promise<void> => {
  const { cmd, args } = buildInstallCommand(tarballUrl);
  logger.dim(`$ ${cmd} ${args.join(' ')}`);
  logger.blank();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', (err) => {
      reject(
        new TuckError(
          `Failed to launch ${cmd}: ${err.message}`,
          'SELF_UPDATE_SPAWN_FAILED',
          [
            `Ensure \`${cmd}\` is installed and on your PATH`,
            cmd === 'sudo'
              ? 'Or re-run as root to skip sudo'
              : 'Try reinstalling Node.js',
          ]
        )
      );
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new TuckError(
          `${cmd} exited with code ${code ?? 'unknown'}`,
          'SELF_UPDATE_INSTALL_FAILED',
          [
            'Review the output above for the underlying error',
            `Manual install: npm install -g ${tarballUrl}`,
          ]
        )
      );
    });
  });
};

const resolveTargetRelease = async (options: SelfUpdateOptions): Promise<ReleaseInfo> => {
  try {
    return options.tag
      ? await fetchReleaseByTag(options.tag)
      : await fetchLatestRelease();
  } catch (error) {
    if (error instanceof UpdaterError) {
      throw new TuckError(error.message, `UPDATER_${error.code}`, [
        error.code === 'NOT_FOUND' && options.tag
          ? `Verify tag "${options.tag}" exists at https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`
          : `Check https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases for manual install`,
        'Re-run with --check to diagnose without attempting an install',
      ]);
    }
    throw error;
  }
};

export interface SelfUpdateResult {
  /** True iff an install actually ran and completed successfully. */
  updated: boolean;
  /** Resolved target version string (undefined when no release was fetched). */
  targetVersion?: string;
  /** True when the user said "no" at the confirm prompt. */
  cancelled?: boolean;
}

export const runSelfUpdate = async (
  options: SelfUpdateOptions = {}
): Promise<SelfUpdateResult> => {
  prompts.intro('tuck self-update');

  const origin = detectInstallOrigin();
  if (origin.kind === 'dev') {
    throw new TuckError(
      'Refusing to self-update a development clone',
      'SELF_UPDATE_DEV_INSTALL',
      [
        `This tuck is running from a dev checkout at ${origin.packageRoot}`,
        'Run `git pull && pnpm build` instead',
        'Set TUCK_SELF_UPDATE_ORIGIN=global to override (not recommended)',
      ]
    );
  }

  const target = await resolveTargetRelease(options);
  const current = VERSION;
  const cmp = compareVersions(current, target.version);

  // --check: report and exit without running an install.
  if (options.check) {
    if (cmp >= 0 && !options.tag) {
      logger.success(`tuck is up to date (${c.bold(current)})`);
      prompts.outro('Nothing to do.');
      process.exitCode = 0;
      return { updated: false, targetVersion: target.version };
    }
    if (cmp === 0 && options.tag) {
      logger.info(`tuck is already on ${c.bold(current)} (matches --tag ${target.tag})`);
      prompts.outro('Nothing to do.');
      process.exitCode = 0;
      return { updated: false, targetVersion: target.version };
    }
    const arrow = cmp < 0 ? '→' : '↓';
    const verb = cmp < 0 ? 'Update available' : 'Downgrade target';
    logger.info(
      `${verb}: ${c.bold(current)} ${arrow} ${c.bold(target.version)} (${target.tag})`
    );
    logger.dim(`  ${target.htmlUrl}`);
    prompts.outro('Run `tuck self-update` to apply.');
    process.exitCode = 1;
    return { updated: false, targetVersion: target.version };
  }

  // Regular flow.
  if (cmp >= 0 && !options.tag) {
    logger.success(`Already on latest (${c.bold(current)})`);
    prompts.outro('Nothing to do.');
    return { updated: false, targetVersion: target.version };
  }

  if (!target.tarballUrl) {
    throw new TuckError(
      `Release ${target.tag} has no "${RELEASE_ASSET_NAME}" asset attached`,
      'SELF_UPDATE_NO_ASSET',
      [
        `Check assets at ${target.htmlUrl}`,
        'Try a different --version, or wait for the release pipeline to finish',
      ]
    );
  }

  const arrow = cmp < 0 ? '→' : '↓';
  logger.info(
    `${cmp < 0 ? 'Update available' : 'Pinning to version'}: ${c.bold(current)} ${arrow} ${c.bold(target.version)} (${target.tag})`
  );
  logger.dim(`  ${target.htmlUrl}`);
  logger.blank();

  if (!options.yes) {
    if (!isInteractive()) {
      throw new NonInteractivePromptError('tuck self-update', [
        'Pass -y/--yes to apply without prompting',
        'Or run with --check to exit non-zero when an update is available',
      ]);
    }
    const confirmed = await prompts.confirm(
      `Install tuck ${target.version}?`,
      true
    );
    if (!confirmed) {
      logger.info('Cancelled.');
      return { updated: false, targetVersion: target.version, cancelled: true };
    }
  }

  await runInstall(target.tarballUrl);

  logger.blank();
  logger.success(`Installed tuck ${target.version}`);
  prompts.outro('Run `tuck --version` in a new shell to confirm.');
  return { updated: true, targetVersion: target.version };
};

export const selfUpdateCommand = new Command('self-update')
  .description('Update tuck to the latest GitHub release')
  .option('--check', 'Report update status without installing (exit 1 if an update is available)')
  .option('-y, --yes', 'Apply the update without prompting')
  .option('--tag <tag>', 'Install a specific release tag (e.g. v1.2.0)')
  .action(async (options: SelfUpdateOptions) => {
    await runSelfUpdate(options);
  });
