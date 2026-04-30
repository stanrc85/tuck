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

  // Modern shell-ecosystem tools beyond the legacy v2 registry. Each entry
  // pairs a low-false-positive detection pattern (rcReferences for canonical
  // shell-init lines, paths for canonical config locations) with a brew
  // formula. Tokens with substring-collision risk (`gh` inside `github`,
  // `mise` inside `promise`, `btm`/`hx` too short generally) drop the
  // rcReferences entry and rely on path-based detection only.
  {
    id: 'zoxide',
    description: 'smarter cd with frecency',
    binary: 'zoxide',
    brewFormula: 'zoxide',
    rcReferences: ['zoxide'],
    paths: [],
    installType: 'brew',
  },
  {
    id: 'starship',
    description: 'cross-shell prompt',
    binary: 'starship',
    brewFormula: 'starship',
    rcReferences: ['starship'],
    paths: ['~/.config/starship.toml'],
    installType: 'brew',
  },
  {
    id: 'atuin',
    description: 'shell history with sync',
    binary: 'atuin',
    brewFormula: 'atuin',
    rcReferences: ['atuin'],
    paths: ['~/.config/atuin/**'],
    installType: 'brew',
  },
  {
    id: 'mise',
    description: 'polyglot runtime version manager',
    binary: 'mise',
    brewFormula: 'mise',
    // Plain `mise` would substring-match `promise`/`compromise`. Use the
    // canonical shell-init patterns instead.
    rcReferences: ['mise activate', 'mise/shims'],
    paths: ['~/.config/mise/**', '~/.tool-versions'],
    installType: 'brew',
  },
  {
    id: 'direnv',
    description: 'per-directory environment loader',
    binary: 'direnv',
    brewFormula: 'direnv',
    rcReferences: ['direnv'],
    paths: ['~/.config/direnv/**', '~/.envrc'],
    installType: 'brew',
  },
  {
    id: 'gh',
    description: 'GitHub CLI',
    binary: 'gh',
    brewFormula: 'gh',
    // `gh` is too short to substring-scan rc files reliably — rely on the
    // ~/.config/gh path. Coverage check still works against `brew install gh`
    // in user tools because that uses word-boundary regex.
    rcReferences: [],
    paths: ['~/.config/gh/**'],
    installType: 'brew',
  },
  {
    id: 'lazygit',
    description: 'terminal UI for git',
    binary: 'lazygit',
    brewFormula: 'lazygit',
    rcReferences: ['lazygit'],
    paths: ['~/.config/lazygit/**'],
    installType: 'brew',
  },
  {
    id: 'bottom',
    description: 'system monitor (btm)',
    binary: 'btm',
    brewFormula: 'bottom',
    // `btm` and `bottom` are both ambiguous in shell rc files; use path-only.
    rcReferences: [],
    paths: ['~/.config/bottom/**'],
    installType: 'brew',
  },
  {
    id: 'helix',
    description: 'modal text editor (hx)',
    binary: 'hx',
    brewFormula: 'helix',
    // `hx` too short for content scan; use path-only.
    rcReferences: [],
    paths: ['~/.config/helix/**'],
    installType: 'brew',
  },
  {
    id: 'tmux',
    description: 'terminal multiplexer',
    binary: 'tmux',
    brewFormula: 'tmux',
    rcReferences: ['tmux'],
    paths: ['~/.tmux.conf', '~/.config/tmux/**'],
    installType: 'brew',
  },
  {
    id: 'zellij',
    description: 'modern terminal multiplexer',
    binary: 'zellij',
    brewFormula: 'zellij',
    rcReferences: ['zellij'],
    paths: ['~/.config/zellij/**'],
    installType: 'brew',
  },
  {
    id: 'pyenv',
    description: 'Python version manager',
    binary: 'pyenv',
    brewFormula: 'pyenv',
    rcReferences: ['pyenv'],
    paths: ['~/.pyenv/**'],
    installType: 'brew',
  },
]);
