import type { ProfileEvent, ProfileReport } from './parser.js';

export interface Recommendation {
  rule: string;
  severity: 'info' | 'warn';
  message: string;
  suggestion: string;
  evidence: string[];
}

// Some rules inspect the actual source file contents (e.g. duplicate PATH
// segments only make sense when looking at literal lines, not xtrace events).
// The source map keys by filename as emitted via PS4 %N — same keys as
// ProfileReport.perFile[].file so the rule engine can correlate.
export interface SourceMap {
  [filename: string]: string;
}

// Return the first whitespace-delimited token of the command, trimmed.
// Used to distinguish real invocations (`compinit -C`) from no-op comments
// (`: compinit '(anon)' ...`) and from loads (`autoload -Uz compinit`).
const firstToken = (command: string): string => command.trim().split(/\s+/)[0] ?? '';

// When a function runs under xtrace, every line inside its body emits an
// event with sourceFile=<function name>. Rules that count invocations of a
// command must exclude these internal events — otherwise a single real call
// inflates to hundreds of false-positive matches.
const isDirectInvocation = (event: ProfileEvent, command: string): boolean =>
  event.sourceFile !== command && firstToken(event.command) === command;

const SKIP_GLOBAL_COMPINIT_RE = /^\s*skip_global_compinit\s*=\s*1\s*(?:#.*)?$/m;

// `compinit` is idempotent but expensive — each call rescans $fpath and
// rebuilds the completion cache. zsh ships with `skip_global_compinit=1`
// (read by /etc/zshrc) that suppresses the distro-level call, leaving only
// the user's own compinit to run once.
const detectMultipleCompinit = (
  report: ProfileReport,
  sources: SourceMap,
): Recommendation | null => {
  const calls = report.events.filter((e) => isDirectInvocation(e, 'compinit'));
  if (calls.length < 2) return null;

  // Already mitigated — user set skip_global_compinit but compinit still runs
  // more than once (e.g. their .zshrc calls it after a plugin framework has
  // already called it). The suggested fix is already in place; don't nag.
  const alreadyMitigated = Object.values(sources).some((content) =>
    SKIP_GLOBAL_COMPINIT_RE.test(content),
  );
  if (alreadyMitigated) return null;

  return {
    rule: 'multiple-compinit',
    severity: 'warn',
    message: `compinit called ${calls.length} times during startup — each call rescans fpath (~100ms)`,
    suggestion:
      'Add `skip_global_compinit=1` to ~/.zshenv to suppress the distro-level compinit. Your user-level compinit in .zshrc stays in charge.',
    evidence: calls.slice(0, 5).map((e) => `${e.sourceFile}:${e.line}> ${e.command}`),
  };
};

// Duplicate PATH segments bloat the PATH string and slow every command lookup
// marginally. We look for literal `PATH=` assignments in source files and
// warn if any segment repeats across them. Requires source-file access —
// xtrace events don't capture variable assignments as parseable text.
const detectDuplicatePath = (sources: SourceMap): Recommendation | null => {
  const segments = new Map<string, Array<{ file: string; line: number }>>();
  for (const [file, content] of Object.entries(sources)) {
    const lines = content.split('\n');
    lines.forEach((text, i) => {
      const match = /(?:^|\s)(?:export\s+)?PATH=["']?([^"'#\n]+)["']?/.exec(text);
      if (!match) return;
      for (const seg of match[1].split(':')) {
        const cleaned = seg.trim();
        if (!cleaned || cleaned.startsWith('$')) continue;
        const prior = segments.get(cleaned) ?? [];
        prior.push({ file, line: i + 1 });
        segments.set(cleaned, prior);
      }
    });
  }
  const duplicates = [...segments.entries()].filter(([, occ]) => occ.length > 1);
  if (duplicates.length === 0) return null;
  return {
    rule: 'duplicate-path',
    severity: 'info',
    message: `${duplicates.length} PATH segment${duplicates.length === 1 ? '' : 's'} appear more than once across your shell config`,
    suggestion:
      'Collapse repeated PATH segments into a single export. Tip: `typeset -U path` in zsh keeps $path unique automatically.',
    evidence: duplicates.slice(0, 5).map(([seg, occ]) => `${seg} — ${occ.map((o) => `${o.file}:${o.line}`).join(', ')}`),
  };
};

// Version managers (nvm, rbenv, pyenv) typically add 200-500ms to startup
// when initialised synchronously. Every shell that doesn't actually use them
// pays the cost. Lazy-load snippets wrap the command in a shim that does
// the real init only on first call.
const VERSION_MANAGER_MARKERS: Array<{
  name: string;
  // Match the real invocation (source ~/.nvm/nvm.sh, eval "$(rbenv init)").
  commandRe: RegExp;
  // Filter out events inside the script itself — those show up with
  // sourceFile matching this regex.
  internalSourceRe: RegExp;
}> = [
  {
    name: 'nvm',
    commandRe: /\bnvm\.sh\b|\bnvm\s+use\b/,
    internalSourceRe: /nvm\.sh$|\/nvm\//,
  },
  {
    name: 'rbenv',
    commandRe: /\brbenv\s+init\b/,
    internalSourceRe: /rbenv\/rbenv\.d|\/rbenv$/,
  },
  {
    name: 'pyenv',
    commandRe: /\bpyenv\s+init\b/,
    internalSourceRe: /pyenv\.d|\/pyenv$/,
  },
];

const detectSyncVersionManagers = (report: ProfileReport): Recommendation | null => {
  const found: Array<{ name: string; evidence: string }> = [];
  for (const { name, commandRe, internalSourceRe } of VERSION_MANAGER_MARKERS) {
    const hit = report.events.find(
      (e) => commandRe.test(e.command) && !internalSourceRe.test(e.sourceFile),
    );
    if (hit) {
      found.push({ name, evidence: `${hit.sourceFile}:${hit.line}> ${hit.command}` });
    }
  }
  if (found.length === 0) return null;
  return {
    rule: 'sync-version-managers',
    severity: 'warn',
    message: `${found.length} version manager${found.length === 1 ? '' : 's'} initialised synchronously at startup: ${found.map((f) => f.name).join(', ')}`,
    suggestion:
      'Wrap each in a lazy-load function that defers the real init to first invocation. See github.com/lukechilds/zsh-nvm for a maintained nvm example.',
    evidence: found.map((f) => f.evidence),
  };
};

// Blocking network / crypto calls during startup (curl, ssh, gpg, git pull)
// gate every shell behind a live connection. Even a fast response adds
// 100-200ms; a slow DNS lookup or unreachable host stalls the shell.
const BLOCKING_COMMAND_NAMES = new Set([
  'curl',
  'wget',
  'ssh',
  'gpg',
  'gpg2',
]);

// Multi-word patterns — matched against the full command rather than just
// the first token. `git pull` has first-token `git`; we want to match the
// action, not every git command.
const BLOCKING_COMMAND_PHRASES = [/^git\s+pull\b/, /^gh\s+auth\b/, /^op\s+signin\b/];

const isBlockingCommand = (command: string): boolean => {
  const trimmed = command.trim();
  if (BLOCKING_COMMAND_NAMES.has(firstToken(trimmed))) return true;
  return BLOCKING_COMMAND_PHRASES.some((re) => re.test(trimmed));
};

const detectBlockingStartup = (report: ProfileReport): Recommendation | null => {
  const hits = report.events.filter((e) => isBlockingCommand(e.command));
  if (hits.length === 0) return null;
  return {
    rule: 'blocking-startup',
    severity: 'warn',
    message: `${hits.length} potentially blocking command${hits.length === 1 ? '' : 's'} during shell startup`,
    suggestion:
      'Move network / crypto calls out of .zshrc into a separately-invoked script, or guard with `[[ -o interactive ]]` + a precmd background job.',
    evidence: hits.slice(0, 5).map((e) => `${e.sourceFile}:${e.line}> ${e.command}`),
  };
};

export const applyRules = (
  report: ProfileReport,
  sources: SourceMap,
): Recommendation[] => {
  return [
    detectMultipleCompinit(report, sources),
    detectDuplicatePath(sources),
    detectSyncVersionManagers(report),
    detectBlockingStartup(report),
  ].filter((r): r is Recommendation => r !== null);
};
