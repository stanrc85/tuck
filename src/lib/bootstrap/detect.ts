import { readFile } from 'fs/promises';
import { pathExists } from 'fs-extra';
import { expandPath } from '../paths.js';
import type { ToolDefinition } from '../../schemas/bootstrap.schema.js';

/**
 * Why a tool was flagged as "already configured on this host." Drives the
 * grey-text annotation next to the tool name in the picker
 * (e.g. `~/.config/pet/ present`, `.zshrc sources fzf.zsh`).
 */
export type DetectionReason =
  | { kind: 'path'; path: string }
  | { kind: 'rc'; file: string; ref: string };

export interface DetectionResult {
  detected: boolean;
  /** Every matching signal, not just the first — useful for debugging picks. */
  reasons: DetectionReason[];
}

/**
 * Shell rc files scanned when a tool declares `rcReferences`. Kept narrow
 * on purpose — scanning every dotfile would be slow and produce false
 * positives. If a tool needs a niche rc (say, `~/.config/fish/conf.d/*`),
 * the caller can widen `options.rcFiles` per-invocation.
 */
export const DEFAULT_RC_FILES: readonly string[] = [
  '~/.zshrc',
  '~/.bashrc',
  '~/.bash_profile',
  '~/.zprofile',
  '~/.profile',
  '~/.config/fish/config.fish',
];

export interface DetectOptions {
  /** Override the rc-file list. Defaults to `DEFAULT_RC_FILES`. */
  rcFiles?: readonly string[];
}

/**
 * Probe the filesystem + shell rc files for evidence that `tool` is already
 * configured on this host. Best-effort: returns `detected: false` with
 * `reasons: []` for tools that declare no detection signals.
 *
 * Failures reading any one path or rc file are swallowed (permission
 * errors, transient I/O) — detection is advisory UX, not a correctness
 * gate, so a partial read shouldn't escalate into a crash.
 */
export const detectTool = async (
  tool: ToolDefinition,
  options: DetectOptions = {}
): Promise<DetectionResult> => {
  const reasons: DetectionReason[] = [];

  const pathResults = await Promise.all(
    tool.detect.paths.map(async (rawPath) => {
      const abs = expandPath(rawPath);
      const exists = await pathExists(abs).catch(() => false);
      return { rawPath, exists };
    })
  );
  for (const { rawPath, exists } of pathResults) {
    if (exists) {
      reasons.push({ kind: 'path', path: rawPath });
    }
  }

  if (tool.detect.rcReferences.length > 0) {
    const rcPaths = options.rcFiles ?? DEFAULT_RC_FILES;
    const rcReads = await Promise.all(
      rcPaths.map(async (rcPath) => {
        const abs = expandPath(rcPath);
        if (!(await pathExists(abs).catch(() => false))) {
          return { rcPath, content: null as string | null };
        }
        try {
          return { rcPath, content: await readFile(abs, 'utf-8') };
        } catch {
          return { rcPath, content: null };
        }
      })
    );

    for (const { rcPath, content } of rcReads) {
      if (content === null) continue;
      for (const ref of tool.detect.rcReferences) {
        if (content.includes(ref)) {
          reasons.push({ kind: 'rc', file: rcPath, ref });
        }
      }
    }
  }

  return { detected: reasons.length > 0, reasons };
};
