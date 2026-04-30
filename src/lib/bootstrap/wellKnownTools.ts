/**
 * Well-known tool catalog used by `tuck restore` to detect references in
 * just-restored dotfiles that aren't backed by a `[[tool]]` block in the
 * user's `bootstrap.toml`.
 *
 * Lineage: the 12 tool ids here mirror the legacy built-in registry that
 * shipped pre-v3 (`src/lib/bootstrap/registry/`). v3 removed install/check/
 * update logic from those entries — bootstrap is fully driven by the user's
 * `bootstrap.toml` now — but the *detection signatures* (rcReferences,
 * paths, brewFormula) stay so we can warn about gaps.
 *
 * Two-tier `installType`:
 *   `brew`   — `brew install <brewFormula>` is sufficient. `tuck restore
 *              --install-missing` will attempt a brew install and notify
 *              the user on failure (formula not found, brew not installed
 *              on host, network error). 9 of 12 tools.
 *   `manual` — needs a real `[[tool]]` block to install correctly:
 *              `neovim-plugins` runs lazy.sync in headless nvim, `zimfw`
 *              uses an upstream curl installer, `zsh` is typically owned
 *              by the system package manager as the login shell.
 *              `--install-missing` only warns; never auto-installs these.
 */

export interface WellKnownTool {
  /** Stable id matching the legacy registry tool id. */
  id: string;
  /** Human-readable description shown in warnings. */
  description: string;
  /**
   * Binary name on PATH (e.g. `rg` for ripgrep, `tldr` for tealdeer,
   * `nvim` for neovim). Used when scanning user `[[tool]]` install
   * commands for coverage signals. Empty string for tools without a
   * single canonical binary (`zimfw`, `neovim-plugins`).
   */
  binary: string;
  /**
   * Linuxbrew formula name. Empty string for tools that aren't a clean
   * `brew install`. Auto-install loop only attempts brew when this is set
   * AND `installType === 'brew'`.
   */
  brewFormula: string;
  /** Substrings scanned in restored shell rc file contents. */
  rcReferences: readonly string[];
  /**
   * Path globs scanned against restored file paths. Same syntax as the
   * existing `associatedConfig` matcher (`/**`, `/*`, literal).
   */
  paths: readonly string[];
  /** See top-of-file two-tier explanation. */
  installType: 'brew' | 'manual';
}

export const WELL_KNOWN_TOOLS: readonly WellKnownTool[] = Object.freeze([
  {
    id: 'fzf',
    description: 'command-line fuzzy finder',
    binary: 'fzf',
    brewFormula: 'fzf',
    rcReferences: ['fzf'],
    paths: ['~/.fzf.zsh', '~/.fzf.bash', '~/.config/fzf/**'],
    installType: 'brew',
  },
  {
    id: 'eza',
    description: 'modern replacement for ls',
    binary: 'eza',
    brewFormula: 'eza',
    rcReferences: ['eza'],
    paths: [],
    installType: 'brew',
  },
  {
    id: 'bat',
    description: 'cat with syntax highlighting',
    binary: 'bat',
    brewFormula: 'bat',
    rcReferences: ['bat'],
    paths: ['~/.config/bat/**'],
    installType: 'brew',
  },
  {
    id: 'fd',
    description: 'fast user-friendly find alternative',
    binary: 'fd',
    brewFormula: 'fd',
    rcReferences: ['fd'],
    paths: [],
    installType: 'brew',
  },
  {
    id: 'ripgrep',
    description: 'fast recursive grep alternative',
    binary: 'rg',
    brewFormula: 'ripgrep',
    rcReferences: ['rg', 'ripgrep'],
    paths: [],
    installType: 'brew',
  },
  {
    id: 'neovim',
    description: 'hyperextensible Vim-based editor',
    binary: 'nvim',
    brewFormula: 'neovim',
    rcReferences: ['nvim'],
    paths: ['~/.config/nvim/**'],
    installType: 'brew',
  },
  {
    id: 'pet',
    description: 'CLI snippet manager',
    binary: 'pet',
    brewFormula: 'pet',
    rcReferences: [],
    paths: ['~/.config/pet/**'],
    installType: 'brew',
  },
  {
    id: 'yazi',
    description: 'terminal file manager',
    binary: 'yazi',
    brewFormula: 'yazi',
    rcReferences: [],
    paths: ['~/.config/yazi/**'],
    installType: 'brew',
  },
  {
    id: 'tealdeer',
    description: 'fast tldr client',
    binary: 'tldr',
    brewFormula: 'tealdeer',
    rcReferences: ['tealdeer', 'tldr'],
    paths: ['~/.config/tealdeer/**'],
    installType: 'brew',
  },
  {
    id: 'neovim-plugins',
    description: 'lazy.nvim-managed neovim plugins',
    binary: '',
    brewFormula: '',
    rcReferences: [],
    paths: ['~/.config/nvim/lua/**', '~/.config/nvim/lazy-lock.json'],
    installType: 'manual',
  },
  {
    id: 'zimfw',
    description: 'modular zsh framework',
    binary: '',
    brewFormula: '',
    rcReferences: ['zimfw'],
    paths: ['~/.zimrc', '~/.config/zsh/.zimrc'],
    installType: 'manual',
  },
  {
    id: 'zsh',
    description: 'z shell',
    binary: 'zsh',
    brewFormula: '',
    rcReferences: ['zsh'],
    paths: [
      '~/.zshrc',
      '~/.zshenv',
      '~/.zprofile',
      '~/.zlogin',
      '~/.zlogout',
      '~/.zsh/**',
      '~/.config/zsh/**',
    ],
    installType: 'manual',
  },
]);
