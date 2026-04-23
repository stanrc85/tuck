# Getting Started

This page walks through installing tuck, setting up your first sync, and restoring on a fresh machine. If you already have tuck installed and want a specific flag, jump to the **[Command Reference](./Command-Reference)**.

## Install

tuck ships as a standalone binary (via the install script), as an npm tarball attached to each release, or as a prebuilt binary from the releases page.

```bash
# One-liner install script — auto-detects platform, downloads binary,
# verifies SHA256, installs to /usr/local/bin (or ~/.local/bin without sudo)
curl -fsSL https://raw.githubusercontent.com/stanrc85/tuck/main/install.sh | bash

# Or via npm — the release tarball ships pre-built, no local build needed
npm install -g https://github.com/stanrc85/tuck/releases/latest/download/tuck.tgz

# Pin to a specific release
npm install -g https://github.com/stanrc85/tuck/releases/download/v1.0.2/tuck.tgz

# Prebuilt standalone binaries live at:
# https://github.com/stanrc85/tuck/releases
```

Verify the install:

```bash
tuck --version
```

## Your first sync

On a host that already has the dotfiles you want to track (your main laptop, say), run:

```bash
tuck init
```

`tuck init` is the interactive single-command setup. It will:

1. Ask where to store the repo — **GitHub**, **GitLab**, **local-only**, or a **custom** git URL
2. Create `~/.tuck/` as the local working copy
3. Scan your system for dotfiles (shell, git, editors, terminal, ssh, misc)
4. Let you select which files to track via a checkbox picker
5. Create the remote repo for you (GitHub/GitLab via their CLIs) or let you paste a URL
6. Commit and push the initial snapshot

When `tuck init` finishes, your dotfiles are tracked under `~/.tuck/files/` and committed to the remote.

## Ongoing workflow

After the initial setup, there's really one command to remember:

```bash
tuck sync
```

`tuck sync` does the full loop — pulls the latest from the remote (rebase with autostash so dirty working trees don't block you), detects changed and added files, commits, and pushes. Run it any time you've changed a dotfile. See [the Command Reference entry for `tuck sync`](./Command-Reference#tuck-sync) for flags like `--list` (preview-only), `-g` (scope to a host-group), and `-m` (custom commit message).

If you want to add or stop tracking specific files:

```bash
tuck add ~/.config/starship.toml      # start tracking
tuck remove --push ~/.oldrc           # stop tracking + delete from remote
```

## On a fresh machine

Two scenarios. Pick the one that fits.

### You're restoring your own setup

```bash
# Point tuck at your dotfiles repo (interactive auth if the provider needs it)
tuck init --from github.com/you/dotfiles

# Write every tracked file back to your system
tuck restore --all

# Install the CLI tools your dotfiles expect (optional, see Bootstrapping Tools)
tuck bootstrap --bundle <your-bundle>
```

If your dotfiles use **[Host Groups](./Host-Groups)** (different sets for different machines), add `-g <group>` to both `tuck restore` and `tuck bootstrap`.

### You want to try someone else's setup

```bash
tuck apply <github-username>
```

`tuck apply` pulls a user's dotfiles, runs smart merging against any files you already have (so your existing `.zshrc` isn't blown away), and asks before overwriting. Like `restore`, it accepts `-g <group>` for multi-host repos.

After `tuck restore` or `tuck apply` finishes, tuck checks whether any tool in your bootstrap catalog configures the paths you just restored (via `associatedConfig` globs) but isn't installed — e.g. you just restored `~/.config/nvim/` onto a box without `nvim`. On an interactive TTY it offers a single prompt to run `tuck bootstrap --tools <missing>` inline. On non-TTY hosts, pass `--install-deps` to auto-install or `--no-install-deps` to skip with an advisory.

## What just happened?

tuck stores your dotfiles in `~/.tuck/`, organized by category:

```
~/.tuck/
├── files/
│   ├── shell/       # .zshrc, .bashrc, .profile, zim configs
│   ├── git/         # .gitconfig, .gitignore_global
│   ├── editors/     # .vimrc, nvim, VS Code settings
│   ├── terminal/    # .tmux.conf, alacritty, kitty, wezterm
│   ├── ssh/         # ssh config (never private keys)
│   └── misc/        # everything else
├── .tuckmanifest.json   # what's tracked + where it comes from
└── .tuckrc.json         # your configuration (shared, committed)
```

The flow is:

```
~/.zshrc          →  ~/.tuck/files/shell/zshrc
~/.gitconfig      →  ~/.tuck/files/git/gitconfig
~/.config/nvim    →  ~/.tuck/files/editors/nvim
```

`tuck sync` writes changes from the source paths into the repo copies; `tuck restore` goes the other way. Every destructive operation (restore, apply, sync-overwriting-repo, remove, clean) takes an automatic snapshot in `~/.tuck-backups/` first so you can [undo](./Time-Machine-and-Undo) if something goes wrong.

## Where to go next

- **Multi-machine setup:** [Host Groups](./Host-Groups) — tag files per host, share one repo across several different machines
- **CLI tools:** [Bootstrapping Tools](./Bootstrapping-Tools) — install neovim, fzf, ripgrep, etc. declaratively
- **Every flag documented:** [Command Reference](./Command-Reference)
- **Task cookbook:** [Recipes](./Recipes) — "set up a consumer host", "migrate from chezmoi", "bootstrap a fresh dev VM"
- **Your dotfiles contain secrets:** [Security & Secrets](./Security-and-Secrets)
