import type { Parser } from './types.js';
import { tmuxParser } from './parsers/tmux.js';
import { zshParser } from './parsers/zsh.js';
import { yaziParser } from './parsers/yazi.js';

/**
 * Built-in parser list. Add new parsers here; `tuck cheatsheet --sources`
 * filters against these ids.
 *
 * Deferred to follow-ups: neovim-lua, vim, hyprland/sway/i3, helix,
 * alacritty/kitty/wezterm, VS Code keybindings.json, bash (bindkey + alias).
 */
export const BUILT_IN_PARSERS: readonly Parser[] = Object.freeze([
  tmuxParser,
  zshParser,
  yaziParser,
]);

export const getParserIds = (): string[] =>
  BUILT_IN_PARSERS.map((p) => p.id);
