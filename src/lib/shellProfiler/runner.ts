import { spawn } from 'child_process';

// PS4 format used for profile output. Both shells emit identical event
// shape — `+<timestamp>|<source>|<line>> <command>` — so the parser stays
// shell-agnostic. The expansion mechanism differs:
//
// zsh — `%D{%s.%6.}` (epoch seconds + 6-digit microsecond fraction), `%N`
// (current source / function name), `%i` (line number).
//
// bash 5+ — `${EPOCHREALTIME}` is a built-in providing the same epoch
// fractional. `${BASH_SOURCE}` and `${LINENO}` give the source / line.
// Pre-bash-5 (macOS default) lacks EPOCHREALTIME — we accept the loss of
// resolution rather than ship two parser shapes.
const PROFILE_PS4_ZSH = '+%D{%s.%6.}|%N|%i> ';
const PROFILE_PS4_BASH = '+${EPOCHREALTIME}|${BASH_SOURCE}|${LINENO}> ';

export type ProfileShell = 'zsh' | 'bash';

export interface ProfileRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  available: boolean; // false if the requested shell isn't installed
}

const ps4For = (shell: ProfileShell): string =>
  shell === 'zsh' ? PROFILE_PS4_ZSH : PROFILE_PS4_BASH;

// `-i` reads interactive startup files (.zshrc / .bashrc); `-c exit`
// terminates the shell once startup finishes. `-x` enables xtrace; `-v`
// echoes each line as read (helpful for correlating events to source
// lines). Combined output lands on stderr.
export const runShellProfile = async (
  shell: ProfileShell,
): Promise<ProfileRunResult> => {
  return await new Promise((resolve) => {
    const child = spawn(
      shell,
      ['-ixc', 'exit'],
      {
        env: { ...process.env, PS4: ps4For(shell) },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        resolve({ stdout: '', stderr: '', exitCode: 0, available: false });
        return;
      }
      resolve({ stdout: '', stderr: err.message, exitCode: 1, available: true });
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0, available: true });
    });
  });
};

// Backwards-compatible alias kept so the historical `runZshProfile` import
// path continues to work for any caller that hard-coded it.
export const runZshProfile = (): Promise<ProfileRunResult> => runShellProfile('zsh');
export const runBashProfile = (): Promise<ProfileRunResult> => runShellProfile('bash');
