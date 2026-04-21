/**
 * Shared types for the `tuck cheatsheet` parser infrastructure.
 *
 * A `Parser` is a format-specific recognizer (tmux, zsh, yazi, …) that
 * decides whether a tracked file is in scope (`match`) and extracts
 * keybinds/aliases from it (`parse`). The orchestrator in `index.ts`
 * runs every registered parser against every tracked text file; parsers
 * self-select via `match` instead of the orchestrator hard-coding
 * filename patterns, so users who stash their tmux config at an
 * unexpected path still get picked up (match on content-sniff as a
 * fallback is fair game).
 */

export interface Entry {
  /** The key sequence or binding identifier (e.g. `Prefix + r`, `<leader>ff`, `ll`). */
  keybind: string;
  /** Human-readable action — what the key does. Falls back to the raw command when no description is available. */
  action: string;
  /** User-facing source file path — already collapsed via `collapsePath` before rendering. */
  sourceFile: string;
  /** 1-indexed line number in the source file for the originating statement. 0 when the parser can't determine one (e.g. structured TOML). */
  sourceLine: number;
  /** Optional sub-grouping within a source (e.g. yazi mode: `manager`, `input`). Reserved for a future `--group-by category` flag. */
  category?: string;
  /** Section header captured from surrounding comments (e.g. `# --- CURSOR MOVEMENT ---`). Reserved for a future `--group-by section` flag. */
  section?: string;
}

export interface ParserContext {
  /** Collapsed source path (`~/.tmux.conf`) for error reporting + Entry.sourceFile. */
  sourceFile: string;
}

export interface Parser {
  /** Stable id used by `--sources` filtering (tmux, zsh, yazi, neovim-lua, …). */
  id: string;
  /** Human-readable section header used by the renderer. */
  label: string;
  /**
   * Does this parser apply to the given file?
   *
   * `sourcePath` is the manifest's collapsed source path (`~/.tmux.conf`);
   * `content` is the raw file body. Parsers typically match on path
   * pattern, but may inspect content to disambiguate (e.g. a `.lua` file
   * that isn't nvim config).
   */
  match: (sourcePath: string, content: string) => boolean;
  /** Extract entries. Return empty array when the parser is confident the file has no entries. */
  parse: (content: string, context: ParserContext) => Entry[];
}

export interface CheatsheetResult {
  /** Every entry keyed by its originating parser id. Empty arrays are elided from the result. */
  sections: { parserId: string; label: string; entries: Entry[] }[];
  /** Total count — convenient for renderer summaries without re-summing. */
  totalEntries: number;
  /** Parser ids that matched no files on this host. Informational — shown in `--verbose` / CLI summary. */
  skippedParsers: string[];
}
