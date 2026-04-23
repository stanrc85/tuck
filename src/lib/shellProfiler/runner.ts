import { spawn } from 'child_process';

// PS4 format used for profile output. `%D{%s.%6.}` gives epoch seconds with
// 6-digit microsecond fractional; `%N` is the current source file/function
// name; `%i` is the line number. `|` delimits so paths with spaces parse.
const PROFILE_PS4 = '+%D{%s.%6.}|%N|%i> ';

export interface ProfileRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  available: boolean; // false if zsh isn't installed
}

export const runZshProfile = async (): Promise<ProfileRunResult> => {
  return await new Promise((resolve) => {
    // `-i` loads the interactive shell config (.zshrc etc.); `-c exit`
    // terminates right after startup finishes. `-x` enables xtrace; `-v`
    // echoes each line as read. Combined output lands on stderr.
    const child = spawn(
      'zsh',
      ['-ixc', 'exit'],
      {
        env: { ...process.env, PS4: PROFILE_PS4 },
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
