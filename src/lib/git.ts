import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import { GitError, GitAuthError } from '../errors.js';
import { pathExists } from './paths.js';
import { join } from 'path';

/**
 * Detect the shape of a git stderr that indicates no usable credentials
 * for the remote. Covers:
 *   - HTTPS with no credential helper: "could not read Username for ..."
 *     or the specific "terminal prompts disabled" message git emits
 *     when GIT_TERMINAL_PROMPT=0 suppresses the interactive prompt.
 *   - HTTPS with wrong credentials: "Authentication failed".
 *   - SSH with no authorized key: "Permission denied (publickey)".
 */
const isAuthFailure = (errString: string): boolean =>
  /could not read Username/i.test(errString) ||
  /terminal prompts disabled/i.test(errString) ||
  /Authentication failed/i.test(errString) ||
  /Permission denied \(publickey\)/i.test(errString) ||
  /fatal: Authentication/i.test(errString);

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  tracking?: string;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  untracked: string[];
  deleted: string[];
  hasChanges: boolean;
}

export interface GitCommit {
  hash: string;
  date: string;
  message: string;
  author: string;
}

const createGit = (dir: string): SimpleGit => {
  const git = simpleGit(dir, {
    binary: 'git',
    maxConcurrentProcesses: 6,
    trimmed: true,
  });
  // Disable git's interactive credential prompt. Without this, a git subprocess
  // with piped stdio (what simple-git uses) hangs forever waiting on stdin
  // the parent never writes to — the failure mode observed on fresh hosts
  // with no credential helper configured. With GIT_TERMINAL_PROMPT=0 git
  // fails fast with "could not read Username", which we translate to a
  // GitAuthError with remediation.
  //
  // simple-git's `.env()` REPLACES the child env instead of adding to it, so
  // we must spread `process.env` to preserve HOME / PATH / SSH_AUTH_SOCK /
  // the credential-helper env vars git needs to authenticate and to read
  // `~/.gitconfig` for `user.name` + `user.email`. The previous version
  // passed only the single variable and broke commits on any host that relied
  // on gitconfig-from-HOME (every normal workstation).
  return git.env({ ...process.env, GIT_TERMINAL_PROMPT: '0' });
};

export const isGitRepo = async (dir: string): Promise<boolean> => {
  const gitDir = join(dir, '.git');
  return pathExists(gitDir);
};

export const initRepo = async (dir: string): Promise<void> => {
  try {
    const git = createGit(dir);
    await git.init();
  } catch (error) {
    throw new GitError('Failed to initialize repository', String(error));
  }
};

export const cloneRepo = async (url: string, dir: string): Promise<void> => {
  try {
    const git = simpleGit();
    await git.clone(url, dir);
  } catch (error) {
    throw new GitError(`Failed to clone repository from ${url}`, String(error));
  }
};

export const addRemote = async (dir: string, name: string, url: string): Promise<void> => {
  try {
    const git = createGit(dir);
    await git.addRemote(name, url);
  } catch (error) {
    throw new GitError('Failed to add remote', String(error));
  }
};

export const removeRemote = async (dir: string, name: string): Promise<void> => {
  try {
    const git = createGit(dir);
    await git.removeRemote(name);
  } catch (error) {
    throw new GitError('Failed to remove remote', String(error));
  }
};

export const getRemotes = async (dir: string): Promise<{ name: string; url: string }[]> => {
  try {
    const git = createGit(dir);
    const remotes = await git.getRemotes(true);
    return remotes.map((r) => ({ name: r.name, url: r.refs.fetch || r.refs.push || '' }));
  } catch (error) {
    throw new GitError('Failed to get remotes', String(error));
  }
};

export const getStatus = async (dir: string): Promise<GitStatus> => {
  try {
    const git = createGit(dir);
    const status: StatusResult = await git.status();

    return {
      isRepo: true,
      branch: status.current || 'main',
      tracking: status.tracking || undefined,
      ahead: status.ahead,
      behind: status.behind,
      staged: status.staged,
      modified: status.modified,
      untracked: status.not_added,
      deleted: status.deleted,
      hasChanges: !status.isClean(),
    };
  } catch (error) {
    throw new GitError('Failed to get status', String(error));
  }
};

export const stageFiles = async (dir: string, files: string[]): Promise<void> => {
  try {
    const git = createGit(dir);
    await git.add(files);
  } catch (error) {
    throw new GitError('Failed to stage files', String(error));
  }
};

export const stageAll = async (dir: string): Promise<void> => {
  try {
    const git = createGit(dir);
    await git.add('.');
  } catch (error) {
    throw new GitError('Failed to stage all files', String(error));
  }
};

export const commit = async (dir: string, message: string): Promise<string> => {
  try {
    const git = createGit(dir);
    const result = await git.commit(message);
    return result.commit;
  } catch (error) {
    throw new GitError('Failed to commit', String(error));
  }
};

/**
 * Configure git to use gh CLI credentials if gh is authenticated
 */
const ensureGitCredentials = async (): Promise<void> => {
  try {
    // Check if gh is authenticated
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    
    const { stdout, stderr } = await execFileAsync('gh', ['auth', 'status']);
    // gh auth status writes its output to stderr per gh CLI design
    const output = (stderr || stdout || '').trim();
    
    if (output.includes('Logged in')) {
      // gh is authenticated, configure git to use it
      await execFileAsync('gh', ['auth', 'setup-git']);
    }
  } catch {
    // gh CLI not available or not authenticated; skip git credential setup.
    // This is expected on systems without gh CLI or when user hasn't logged in.
    // Git will fall back to default credential mechanisms (ssh keys, https tokens, etc.)
  }
};

export const push = async (
  dir: string,
  options?: { remote?: string; branch?: string; force?: boolean; setUpstream?: boolean }
): Promise<void> => {
  try {
    // Ensure git can use gh credentials if available
    await ensureGitCredentials();
    
    const git = createGit(dir);
    const args: string[] = [];

    if (options?.setUpstream) {
      args.push('-u');
    }
    if (options?.force) {
      args.push('--force');
    }

    const remote = options?.remote || 'origin';
    const branch = options?.branch;

    if (branch) {
      await git.push([...args, remote, branch]);
    } else {
      await git.push([...args, remote]);
    }
  } catch (error) {
    const errString = String(error);
    if (isAuthFailure(errString)) {
      throw new GitAuthError(errString);
    }
    throw new GitError('Failed to push', errString);
  }
};

export const pull = async (
  dir: string,
  options?: { remote?: string; branch?: string; rebase?: boolean }
): Promise<void> => {
  try {
    const git = createGit(dir);
    const args: string[] = [];

    if (options?.rebase) {
      args.push('--rebase');
      // `git pull --rebase` refuses outright on any unstaged change, even
      // incidental dirt the rebase wouldn't touch. Tuck writes to the
      // tracked .gitignore on first bootstrap (ensureBootstrapStateGitignored
      // / ensureLocalConfigGitignored append to it on upgraders), which
      // would otherwise block every subsequent `tuck sync` / `tuck update`.
      // --autostash stashes before the rebase and pops after, so the
      // rebase sees a clean tree. Matches `pull.rebase = preserve` UX git
      // users expect.
      args.push('--autostash');
    }

    const remote = options?.remote || 'origin';
    const branch = options?.branch;

    if (branch) {
      await git.pull(remote, branch, args);
    } else {
      await git.pull(remote, undefined, args);
    }
  } catch (error) {
    const errString = String(error);
    if (isAuthFailure(errString)) {
      throw new GitAuthError(errString);
    }
    throw new GitError('Failed to pull', errString);
  }
};

export const fetch = async (dir: string, remote = 'origin'): Promise<void> => {
  try {
    const git = createGit(dir);
    await git.fetch(remote);
  } catch (error) {
    const errString = String(error);
    if (isAuthFailure(errString)) {
      throw new GitAuthError(errString);
    }
    throw new GitError('Failed to fetch', errString);
  }
};

export const getLog = async (
  dir: string,
  options?: { maxCount?: number; since?: string }
): Promise<GitCommit[]> => {
  try {
    const git = createGit(dir);
    const logOptions: { maxCount?: number; from?: string } = {
      maxCount: options?.maxCount || 10,
    };

    if (options?.since) {
      logOptions.from = options.since;
    }

    const log = await git.log(logOptions);

    return log.all.map((entry) => ({
      hash: entry.hash,
      date: entry.date,
      message: entry.message,
      author: entry.author_name || 'Unknown',
    }));
  } catch (error) {
    throw new GitError('Failed to get log', String(error));
  }
};

export const getDiff = async (
  dir: string,
  options?: { staged?: boolean; stat?: boolean; files?: string[] }
): Promise<string> => {
  try {
    const git = createGit(dir);
    const args: string[] = [];

    if (options?.staged) {
      args.push('--staged');
    }
    if (options?.stat) {
      args.push('--stat');
    }
    if (options?.files) {
      args.push('--');
      args.push(...options.files);
    }

    const result = await git.diff(args);
    return result;
  } catch (error) {
    throw new GitError('Failed to get diff', String(error));
  }
};

/**
 * Return the SHA of HEAD, or null if the dir isn't a repo / has no commits.
 * Used by `tuck update` to detect whether a pull actually changed anything.
 */
export const getHeadSha = async (dir: string): Promise<string | null> => {
  try {
    const git = createGit(dir);
    const sha = await git.revparse(['HEAD']);
    return sha.trim() || null;
  } catch {
    return null;
  }
};

/**
 * Return how many commits the local branch is ahead / behind its upstream.
 * Both zero when upstream is unset or the repo has no commits. Requires that
 * `fetch` has run recently for `behind` to be meaningful.
 */
export const getAheadBehind = async (
  dir: string
): Promise<{ ahead: number; behind: number }> => {
  try {
    const status = await getStatus(dir);
    return { ahead: status.ahead, behind: status.behind };
  } catch {
    return { ahead: 0, behind: 0 };
  }
};

/**
 * Hard-reset the working tree to match a target ref (default: upstream of
 * the current branch, `@{u}`). Used by `tuck pull --mirror` to treat the
 * local repo as a read-only mirror of the remote. Destroys local commits
 * not in the target — callers must gate with a divergence check.
 */
export const resetHard = async (dir: string, target = '@{u}'): Promise<void> => {
  try {
    const git = createGit(dir);
    await git.raw(['reset', '--hard', target]);
  } catch (error) {
    throw new GitError(`Failed to reset --hard to ${target}`, String(error));
  }
};

export const getCurrentBranch = async (dir: string): Promise<string> => {
  try {
    const git = createGit(dir);
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    return branch.trim();
  } catch {
    // Fallback for repos with no commits - read symbolic-ref directly
    try {
      const git = createGit(dir);
      const ref = await git.raw(['symbolic-ref', '--short', 'HEAD']);
      return ref.trim();
    } catch {
      // Last resort - return default branch name
      return 'main';
    }
  }
};

export const hasRemote = async (dir: string, name = 'origin'): Promise<boolean> => {
  try {
    const remotes = await getRemotes(dir);
    return remotes.some((r) => r.name === name);
  } catch {
    return false;
  }
};

export const getRemoteUrl = async (dir: string, name = 'origin'): Promise<string | null> => {
  try {
    const remotes = await getRemotes(dir);
    const remote = remotes.find((r) => r.name === name);
    return remote?.url || null;
  } catch {
    return null;
  }
};

export const setDefaultBranch = async (dir: string, branch: string): Promise<void> => {
  try {
    const git = createGit(dir);
    await git.branch(['-M', branch]);
  } catch (error) {
    throw new GitError('Failed to set default branch', String(error));
  }
};
