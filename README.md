<div align="center">
  <img src="public/tuck.png" alt="tuck logo" width="180">

  # tuck

  **The modern dotfiles manager**

  Simple, fast, and beautiful. Manage your dotfiles with Git, sync across machines, and never lose your configs again.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/stanrc85/tuck/actions/workflows/ci.yml/badge.svg)](https://github.com/stanrc85/tuck/actions/workflows/ci.yml)

[Website](https://tuck.sh) · [Wiki](https://github.com/stanrc85/tuck/wiki) · [Install](#install) · [Quick Start](#quick-start)

  <img src="public/tuck_preview.png" alt="tuck preview" width="650">

</div>

---

## Why tuck?

- **One command to rule them all** — `tuck init` scans your system, lets you pick what to track, and syncs to your remote
- **Multi-provider support** — GitHub, GitLab (including self-hosted), Gitea, local-only, or any custom git remote
- **Smart detection** — auto-categorizes dotfiles (shell, git, editors, terminal, ssh, etc.)
- **Beautiful CLI** — gorgeous prompts, spinners, and progress bars powered by @clack/prompts
- **Safe by default** — creates snapshots before every destructive operation, never overwrites without asking
- **Git-native** — uses Git under the hood but hides the complexity
- **Cross-platform** — works on macOS, Linux, and Windows

## Install

```bash
# One-liner install script — auto-detects platform, verifies SHA256
curl -fsSL https://raw.githubusercontent.com/stanrc85/tuck/main/install.sh | bash

# Or install the latest release via npm (tarball ships pre-built)
npm install -g https://github.com/stanrc85/tuck/releases/latest/download/tuck.tgz

# Pin to a specific release
npm install -g https://github.com/stanrc85/tuck/releases/download/v1.0.2/tuck.tgz

# Prebuilt standalone binaries also live at
# https://github.com/stanrc85/tuck/releases
```

## Quick Start

### First time

```bash
# Interactive — scans your system, pick what to track, syncs to GitHub
tuck init
```

`tuck init` asks where to store the repo (GitHub / GitLab / local / custom), creates `~/.tuck/`, scans for dotfiles, lets you pick, commits, and pushes. See the [Getting Started guide](https://github.com/stanrc85/tuck/wiki/Getting-Started) for the full walkthrough.

### Ongoing

```bash
tuck sync
```

Detects changes, pulls latest from the remote, commits, pushes — all in one loop.

### On a new machine

```bash
tuck init --from github.com/you/dotfiles     # point tuck at your repo
tuck restore --all                           # write every tracked file back
tuck bootstrap --bundle <your-bundle>        # install the CLI tools they expect
```

Or apply someone else's public dotfiles: `tuck apply <github-user>`.

## Top commands

| Command | What it does |
|---|---|
| `tuck init` | First-time setup — scan, pick, sync |
| `tuck sync` | Detect + commit + push changes (pulls first) |
| `tuck status` | What's tracked, what's changed |
| `tuck add <paths>` | Start tracking files |
| `tuck remove --push <paths>` | Stop tracking + delete from remote |
| `tuck diff` | Preview changes (`-s` side-by-side, `--stat` bar graph) |
| `tuck restore --all` | Write repo → system |
| `tuck undo` | Roll back the last destructive op |

Full list with flags and examples: [**Command Reference**](https://github.com/stanrc85/tuck/wiki/Command-Reference).

## Where to go next

| If you want to… | Read |
|---|---|
| Walk through your first sync | [Getting Started](https://github.com/stanrc85/tuck/wiki/Getting-Started) |
| Find the exact flag for a command | [Command Reference](https://github.com/stanrc85/tuck/wiki/Command-Reference) |
| Run one repo across several machines | [Host Groups](https://github.com/stanrc85/tuck/wiki/Host-Groups) |
| Install your CLI tools on a fresh host | [Bootstrapping Tools](https://github.com/stanrc85/tuck/wiki/Bootstrapping-Tools) |
| Configure tuck (`.tuckrc.json`) | [Configuration Reference](https://github.com/stanrc85/tuck/wiki/Configuration-Reference) |
| Roll back a mistake | [Time Machine & Undo](https://github.com/stanrc85/tuck/wiki/Time-Machine-and-Undo) |
| Use self-hosted GitLab / Gitea / custom | [Git Providers](https://github.com/stanrc85/tuck/wiki/Git-Providers) |
| Keep secrets out of your repo | [Security & Secrets](https://github.com/stanrc85/tuck/wiki/Security-and-Secrets) |
| Run code before/after sync/restore | [Hooks](https://github.com/stanrc85/tuck/wiki/Hooks) |
| Solve a specific task | [Recipes](https://github.com/stanrc85/tuck/wiki/Recipes) |

The full wiki landing page: [github.com/stanrc85/tuck/wiki](https://github.com/stanrc85/tuck/wiki).

## How tuck stores your dotfiles

```
~/.tuck/
├── files/
│   ├── shell/       # .zshrc, .bashrc, .profile
│   ├── git/         # .gitconfig, .gitignore_global
│   ├── editors/     # .vimrc, nvim, VS Code settings
│   ├── terminal/    # .tmux.conf, alacritty, kitty
│   ├── ssh/         # ssh config (never private keys)
│   └── misc/        # everything else
├── .tuckmanifest.json
└── .tuckrc.json
```

```
~/.zshrc          →  ~/.tuck/files/shell/zshrc
~/.gitconfig      →  ~/.tuck/files/git/gitconfig
~/.config/nvim    →  ~/.tuck/files/editors/nvim
```

## Development

```bash
git clone https://github.com/stanrc85/tuck.git
cd tuck
pnpm install
pnpm build
pnpm test
```

Deeper contributor docs: [`CLAUDE.md`](./CLAUDE.md), [`AGENTS.md`](./AGENTS.md), and [`docs/`](./docs/) for testing, benchmarking, and error-code reference. Wiki content is edited under [`docs/wiki/`](./docs/wiki/) — see [`docs/wiki-sync.md`](./docs/wiki-sync.md) for the editor's guide.

## Contributing

Contributions welcome. Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and submit PRs against `main`.

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">
  <sub>Made with love in San Francisco and State College</sub>
</div>
