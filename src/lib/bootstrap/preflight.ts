import { spawn } from 'child_process';
import { statfs } from 'fs/promises';
import { homedir } from 'os';
import type { ToolDefinition } from '../../schemas/bootstrap.schema.js';
import { scriptUsesSudo } from './runner.js';
import { prompts, isInteractive } from '../../ui/index.js';

/**
 * Preflight checks (TASK-051) — fast probes that surface the most common
 * pre-bootstrap pitfalls (clock skew, apt lock held, low disk, no network,
 * uncached sudo) with actionable remediation hints. Each probe is a pure
 * function with injected deps so the runner can be unit-tested without
 * hitting the real network / spawning processes.
 *
 * Motivation: a fresh-kubuntu install (04.21.2026) burned a debug round
 * trip on a clock-skew issue that apt surfaced as `release file not valid
 * yet (invalid for another 1h)` after ~100 lines of unrelated tool output.
 * A 2-second upfront probe would have caught it instantly.
 *
 * Out of scope: auto-remediation. Preflight detects + informs only.
 */

export type CheckStatus = 'pass' | 'warn' | 'skip';

export interface CheckResult {
  /** Human-readable check name shown in warnings. */
  name: string;
  status: CheckStatus;
  /** Free-form detail when `status === 'warn'` (and sometimes 'skip'). */
  message?: string;
  /** Suggested fix or follow-up command for warn results. */
  remediation?: string;
}

export interface PreflightDeps {
  spawnImpl?: typeof spawn;
  fetchImpl?: typeof fetch;
  statfsImpl?: typeof statfs;
  platform?: NodeJS.Platform;
  /** Override TTY detection in tests (mirrors process.stdout.isTTY). */
  isTTY?: boolean;
}

const CLOCK_SKEW_THRESHOLD_MS = 30 * 60 * 1000;
const DISK_SPACE_THRESHOLD_BYTES = 1024 * 1024 * 1024;
const NETWORK_TIMEOUT_MS = 5000;
const CLOCK_TIMEOUT_MS = 5000;

const fetchWithTimeout = async (
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { method: 'HEAD', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const checkClockSkew = async (deps: PreflightDeps = {}): Promise<CheckResult> => {
  const fetchFn = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchWithTimeout(fetchFn, 'https://1.1.1.1', CLOCK_TIMEOUT_MS);
    const dateHeader = response.headers.get('date');
    if (!dateHeader) {
      return { name: 'Clock skew', status: 'skip', message: 'No Date header in response' };
    }

    const remoteMs = Date.parse(dateHeader);
    if (Number.isNaN(remoteMs)) {
      return { name: 'Clock skew', status: 'skip', message: 'Could not parse remote Date header' };
    }

    const skewMs = Math.abs(Date.now() - remoteMs);
    if (skewMs > CLOCK_SKEW_THRESHOLD_MS) {
      const minutes = Math.round(skewMs / 60000);
      return {
        name: 'Clock skew',
        status: 'warn',
        message: `System clock is ${minutes} min off — apt rejects signed Release files when the clock is too far behind`,
        remediation: 'sudo timedatectl set-ntp true && sudo systemctl restart systemd-timesyncd',
      };
    }
    return { name: 'Clock skew', status: 'pass' };
  } catch {
    // Network failure or abort — clock-source unreachable. Network probe
    // will catch the same condition with a more useful message; skip here.
    return { name: 'Clock skew', status: 'skip', message: 'Could not reach time source' };
  }
};

export const checkAptLock = async (deps: PreflightDeps = {}): Promise<CheckResult> => {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'linux') {
    return { name: 'apt lock', status: 'skip' };
  }

  const spawnFn = deps.spawnImpl ?? spawn;
  const held = await new Promise<boolean | 'unknown'>((resolve) => {
    const proc = spawnFn('fuser', ['/var/lib/dpkg/lock-frontend'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    proc.on('error', () => resolve('unknown'));
    proc.on('close', (code) => resolve(code === 0));
  });

  if (held === 'unknown') {
    return { name: 'apt lock', status: 'skip', message: '`fuser` not available' };
  }
  if (held === true) {
    return {
      name: 'apt lock',
      status: 'warn',
      message: '/var/lib/dpkg/lock-frontend is held by another process',
      remediation: 'Wait for the running apt/dpkg/unattended-upgrades job; check `ps -ef | grep -i apt`',
    };
  }
  return { name: 'apt lock', status: 'pass' };
};

export const checkDiskSpace = async (deps: PreflightDeps = {}): Promise<CheckResult> => {
  try {
    const statfsFn = deps.statfsImpl ?? statfs;
    const stats = await statfsFn(homedir());
    const freeBytes = stats.bavail * stats.bsize;
    if (freeBytes < DISK_SPACE_THRESHOLD_BYTES) {
      const freeMb = Math.round(freeBytes / 1_048_576);
      return {
        name: 'Disk space',
        status: 'warn',
        message: `${freeMb} MB free in $HOME — node + go toolchains can want 500 MB+`,
        remediation: 'Free up space, or pass `--skip-preflight` if you know the bundle fits',
      };
    }
    return { name: 'Disk space', status: 'pass' };
  } catch {
    return { name: 'Disk space', status: 'skip', message: 'statfs unavailable' };
  }
};

export const checkNetworkReachable = async (deps: PreflightDeps = {}): Promise<CheckResult> => {
  const fetchFn = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchWithTimeout(fetchFn, 'https://github.com', NETWORK_TIMEOUT_MS);
    if (response.status >= 500) {
      return {
        name: 'Network',
        status: 'warn',
        message: `github.com responded ${response.status}`,
      };
    }
    return { name: 'Network', status: 'pass' };
  } catch {
    return {
      name: 'Network',
      status: 'warn',
      message: 'Could not reach github.com (DNS or connectivity issue)',
      remediation: 'Check `ping github.com` and your DNS resolver',
    };
  }
};

export const checkSudoReachable = async (
  toolsNeedSudo: boolean,
  deps: PreflightDeps = {}
): Promise<CheckResult> => {
  if (!toolsNeedSudo) {
    return { name: 'sudo credentials', status: 'skip' };
  }

  const platform = deps.platform ?? process.platform;
  if (platform === 'win32') {
    return { name: 'sudo credentials', status: 'skip' };
  }

  const spawnFn = deps.spawnImpl ?? spawn;
  const cached = await new Promise<boolean>((resolve) => {
    const proc = spawnFn('sudo', ['-n', 'true'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });

  if (cached) {
    return { name: 'sudo credentials', status: 'pass' };
  }

  // Not cached. In a TTY, the runner will prompt the user inline when it
  // hits the first sudo-using tool — that's a recoverable flow, not a
  // preflight warning. Only warn when there's no TTY to pick up the prompt.
  const isTTY = deps.isTTY ?? !!process.stdout.isTTY;
  if (isTTY) {
    return { name: 'sudo credentials', status: 'pass' };
  }
  return {
    name: 'sudo credentials',
    status: 'warn',
    message: 'No cached sudo credentials and not running in a TTY — sudo-using tools will hang or fail',
    remediation: 'Run `sudo -v` first to cache credentials, then rerun',
  };
};

/**
 * Whether any tool in the plan invokes sudo from its install/update
 * script. Reuses the same regex the runner uses for its per-tool pre-check.
 */
export const planNeedsSudo = (tools: ToolDefinition[]): boolean => {
  return tools.some(
    (t) => scriptUsesSudo(t.install) || (t.update !== undefined && scriptUsesSudo(t.update))
  );
};

export interface PreflightResult {
  results: CheckResult[];
  /** Subset where status === 'warn'. Caller decides whether to prompt. */
  warnings: CheckResult[];
}

const CHECK_NAMES = [
  'Clock skew',
  'apt lock',
  'Disk space',
  'Network',
  'sudo credentials',
] as const;

export const runPreflightChecks = async (
  tools: ToolDefinition[],
  deps: PreflightDeps = {}
): Promise<PreflightResult> => {
  const toolsNeedSudo = planNeedsSudo(tools);

  const settled = await Promise.allSettled([
    checkClockSkew(deps),
    checkAptLock(deps),
    checkDiskSpace(deps),
    checkNetworkReachable(deps),
    checkSudoReachable(toolsNeedSudo, deps),
  ]);

  const results: CheckResult[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { name: CHECK_NAMES[i]!, status: 'skip', message: 'Check threw — skipping' }
  );

  return { results, warnings: results.filter((r) => r.status === 'warn') };
};

/**
 * Run preflight probes and surface any warnings inline. Returns `true`
 * when the user aborted at the continue-anyway prompt; the caller bails
 * out without executing. Non-TTY runs proceed regardless — preflight
 * is informational, not blocking, so CI doesn't snap on a soft warning.
 *
 * Lives here (not in commands/) so both `bootstrap` and `bootstrap-update`
 * can call it without creating a circular import between sibling commands.
 */
export const runPreflightAndMaybeAbort = async (
  tools: ToolDefinition[]
): Promise<boolean> => {
  const { warnings } = await runPreflightChecks(tools);
  if (warnings.length === 0) {
    return false;
  }

  for (const w of warnings) {
    prompts.log.warning(`${w.name}: ${w.message ?? 'failed'}`);
    if (w.remediation) {
      prompts.log.message(`   → ${w.remediation}`);
    }
  }

  if (!isInteractive()) {
    return false;
  }

  const proceed = await prompts.confirm(
    `${warnings.length} preflight warning${warnings.length === 1 ? '' : 's'}. Continue anyway?`,
    false
  );
  if (!proceed) {
    prompts.cancel('Aborted at preflight. Re-run with `--skip-preflight` to override.');
    return true;
  }
  return false;
};
