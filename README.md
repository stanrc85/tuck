<div align="center">
  <img src="public/tuck.png" alt="tuck logo" width="180">
  
  # tuck
  
  **The modern dotfiles manager**
  
  Simple, fast, and beautiful. Manage your dotfiles with Git, sync across machines, and never lose your configs again.

[![npm version](https://img.shields.io/npm/v/@prnv/tuck.svg)](https://www.npmjs.com/package/@prnv/tuck)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/Pranav-Karra-3301/tuck/actions/workflows/ci.yml/badge.svg)](https://github.com/Pranav-Karra-3301/tuck/actions/workflows/ci.yml)

[Website](https://tuck.sh) · [Install](#installation) · [Quick Start](#quick-start) · [Commands](#commands)

<img src="public/tuck_preview.png" alt="tuck preview" width="650">

</div>

---

## Why tuck?

- **One command to rule them all** — `tuck init` scans your system, lets you pick what to track, and syncs to your remote
- **Multi-provider support** — GitHub, GitLab (including self-hosted), local-only, or any custom git remote
- **Smart detection** — Auto-categorizes dotfiles (shell, git, editors, terminal, ssh, etc.)
- **Beautiful CLI** — Gorgeous prompts, spinners, and progress bars powered by @clack/prompts
- **Safe by default** — Creates backups before every operation, never overwrites without asking
- **Git-native** — Uses Git under the hood but hides the complexity
- **Cross-platform** — Works on macOS, Linux, and Windows

## Installation

```bash
# npm (all platforms)
npm install -g @prnv/tuck

# Homebrew (macOS/Linux) - coming soon
brew install pranav-karra-3301/tap/tuck

# pnpm (all platforms)
pnpm add -g @prnv/tuck

# yarn (all platforms)
yarn global add @prnv/tuck

# Windows (PowerShell)
npm install -g @prnv/tuck
# Or download the binary from GitHub Releases
```

## Quick Start

### First time setup

```bash
# Interactive setup - scans your system, pick what to track, syncs to GitHub
tuck init
```

That's it! `tuck init` does everything:

1. **Asks where to store** — GitHub, GitLab, local-only, or custom remote
2. Creates `~/.tuck` repository
3. Scans your system for dotfiles
4. Lets you select which to track
5. Creates a remote repo (if using GitHub/GitLab)
6. Commits and pushes

### Ongoing workflow

```bash
# Detect changes, find new dotfiles, commit, and push - all in one
tuck sync
```

### On a new machine

```bash
# Apply dotfiles from any GitHub user
tuck apply username

# Or clone your own and restore
tuck init --from github.com/you/dotfiles
tuck restore --all
```

## Commands

### Essential (what you'll use 99% of the time)

| Command       | Description                                                             |
| ------------- | ----------------------------------------------------------------------- |
| `tuck init`   | Set up tuck - scans for dotfiles, select what to track, syncs to GitHub |
| `tuck sync`   | Detect changes + new files, commit, and push (pulls first if behind)    |
| `tuck status` | See what's tracked, what's changed, and sync status                     |

### Managing Files

| Command                      | Description                                                           |
| ---------------------------- | --------------------------------------------------------------------- |
| `tuck add <paths>`           | Manually track specific files (`-g <group>` to tag for a host)        |
| `tuck remove <paths>`        | Stop tracking files (`--push` to also delete from remote)             |
| `tuck scan`                  | Discover dotfiles without syncing                                     |
| `tuck list`                  | List all tracked files by category (`-g <group>` to filter)           |
| `tuck diff [file]`           | Show what's changed                                                   |
| `tuck ignore add <paths>`    | Append paths to `.tuckignore` so scan/add skip them                   |
| `tuck ignore rm <paths>`     | Remove paths from `.tuckignore`                                       |
| `tuck ignore list`           | Show ignored paths                                                    |
| `tuck group add <g> <paths>` | Tag tracked files with a host-group                                   |
| `tuck group rm <g> <paths>`  | Remove a host-group tag (keeps at least one group per file)           |
| `tuck group list`            | List all host-groups and their file counts                            |
| `tuck group show <group>`    | Show files in a given host-group                                      |
| `tuck migrate`               | One-time: tag existing files with a host-group (required after 2.0)   |

### Syncing

| Command     | Description      |
| ----------- | ---------------- |
| `tuck push` | Push to remote   |
| `tuck pull` | Pull from remote |

### Restoring

| Command             | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `tuck apply <user>` | Apply dotfiles from a GitHub user, with smart merging (`-g` to pick a group) |
| `tuck restore`      | Restore dotfiles from repo to system (`-g` to pick a group)                  |
| `tuck undo`         | Restore from Time Machine backup snapshots                                   |

### Configuration

| Command              | Description                                  |
| -------------------- | -------------------------------------------- |
| `tuck config`        | View/edit configuration                      |
| `tuck config remote` | Configure git provider (GitHub/GitLab/local) |
| `tuck config wizard` | Interactive configuration setup              |

### Diagnostics

| Command         | Description                                          |
| --------------- | ---------------------------------------------------- |
| `tuck doctor`   | Run repository health and safety diagnostics         |

`tuck doctor` flags:
- `--json`: Machine-readable output for CI
- `--strict`: Treat warnings as non-zero exit
- `--category <env|repo|manifest|security|hooks>`: Run one check group

## How It Works

tuck stores your dotfiles in `~/.tuck`, organized by category:

```
~/.tuck/
├── files/
│   ├── shell/      # .zshrc, .bashrc, .profile
│   ├── git/        # .gitconfig, .gitignore_global
│   ├── editors/    # .vimrc, nvim, VS Code settings
│   ├── terminal/   # .tmux.conf, alacritty, kitty
│   ├── ssh/        # ssh config (never keys!)
│   └── misc/       # everything else
├── .tuckmanifest.json
└── .tuckrc.json
```

**The flow:**

```
~/.zshrc          →  ~/.tuck/files/shell/zshrc
~/.gitconfig      →  ~/.tuck/files/git/gitconfig
~/.config/nvim    →  ~/.tuck/files/editors/nvim
```

Run `tuck sync` anytime to detect changes and push. On a new machine, run `tuck apply username` to grab anyone's dotfiles.

## Host Groups

Tag each tracked file with one or more **host-groups** (e.g. `work`, `kubuntu`, `kali`) so a single dotfiles repo can power several very different machines. Every tracked file belongs to at least one group; commands that apply files accept `-g/--group` to filter by host.

### Typical workflow

```bash
# On your work laptop — tag everything as "work"
tuck add ~/.zshrc ~/.gitconfig -g work

# On your personal desktop — pull and apply only the "personal" set
tuck apply you/dotfiles -g personal

# Move a file between groups
tuck group add personal ~/.zshrc
tuck group rm work ~/.zshrc

# See what you've got
tuck group list
tuck group show work
```

### Defaults

If you omit `-g` on `tuck add`, the file is tagged with `config.defaultGroups` (set via `tuck migrate` or edit `~/.tuck/.tuckrc.json`), falling back to your machine's hostname. Set a sensible default once and most `tuck add` calls won't need the flag.

### Migrating from 1.x

If you upgraded from a 1.x manifest (no groups), every command will error with `MigrationRequiredError` until you run:

```bash
# Interactive — prompts for the group name (defaults to hostname)
tuck migrate

# Or non-interactive
tuck migrate -g laptop

# Multiple groups supported
tuck migrate -g laptop -g work
```

`tuck migrate` is idempotent; running it on an already-migrated manifest is a no-op.

## One-Shot Remove + Push

Use `tuck remove --push` to untrack files, delete them from the repo, commit, and push — all in one step. Your source path on the host is **never** touched:

```bash
# Drop ~/.oldrc from tracking and the remote in one go
tuck remove --push ~/.oldrc

# Custom commit message
tuck remove --push -m "chore: stop tracking legacy config" ~/.oldrc
```

`--push` implies `--delete`. If the push fails (network, auth), the commit is kept locally and tuck prompts you to retry up to 3 times — run `tuck push` later if you declined.

## Git Providers

tuck supports multiple git hosting providers, detected automatically during setup:

| Provider | CLI Required | Features |
|----------|--------------|----------|
| **GitHub** | `gh` | Auto-create repos, full integration |
| **GitLab** | `glab` | Auto-create repos, self-hosted support |
| **Local** | None | No remote sync, local git only |
| **Custom** | None | Any git URL (Bitbucket, Gitea, etc.) |

### Switching Providers

```bash
# Change provider anytime
tuck config remote

# Or via interactive config menu
tuck config
# → Select "Configure remote"
```

### Self-Hosted GitLab

tuck supports self-hosted GitLab instances:

```bash
tuck init
# → Select GitLab
# → Select "Self-hosted"
# → Enter your GitLab host (e.g., gitlab.company.com)
```

## Configuration

Configure tuck via `~/.tuck/.tuckrc.json` or `tuck config wizard`:

```json
{
  "repository": {
    "autoCommit": true,
    "autoPush": false
  },
  "files": {
    "strategy": "copy",
    "backupOnRestore": true
  },
  "defaultGroups": ["work-laptop"],
  "remote": {
    "mode": "github",
    "username": "your-username"
  }
}
```

`defaultGroups` — applied by `tuck add` when `-g` is omitted. Set during `tuck migrate` or edit it here to change what a bare `tuck add` does.

### File Strategies

- **copy** (default) — Files are copied. Run `tuck sync` to update the repo.
- **symlink** — tuck copies the file into the repo, then replaces the original path with a symlink to the repo file. Changes are instant, but this modifies your home dotfile paths.

## Windows Support

tuck fully supports Windows with platform-specific handling:

### Detected Windows Dotfiles

| Category | Files |
|----------|-------|
| **Shell** | PowerShell profiles (`Microsoft.PowerShell_profile.ps1`) |
| **Terminal** | Windows Terminal settings, ConEmu/Cmder configs |
| **Editors** | VS Code, Cursor, Neovim (in `%LOCALAPPDATA%`) |
| **Git** | `.gitconfig`, `.gitignore_global` |
| **SSH** | SSH config in `%USERPROFILE%\.ssh` |
| **Misc** | WSL config (`.wslconfig`), Docker, Kubernetes |

### Windows-Specific Behavior

- **Symlinks**: On Windows, tuck uses directory junctions (don't require admin privileges) or falls back to copying files
- **Permissions**: Unix-style file permissions (chmod) don't apply on Windows; tuck handles this gracefully
- **Paths**: Windows environment variables (`%APPDATA%`, `%LOCALAPPDATA%`, `%USERPROFILE%`) are automatically expanded
- **Hooks**: tuck uses PowerShell Core (`pwsh`) or Windows PowerShell for hook execution

### PowerShell Profile Merging

tuck supports smart merging for PowerShell profiles with preserve markers:

```powershell
# In your PowerShell profile, mark local-only sections:
<# tuck:preserve #>
# Machine-specific aliases
Set-Alias code "C:\Program Files\Microsoft VS Code\Code.exe"
<# /tuck:preserve #>
```

## Security

tuck is designed with security in mind:

- **Never tracks private keys** — SSH keys, `.env` files, and credentials are blocked by default
- **Secret scanning** — Warns if files contain API keys or tokens
- **Placeholder support** — Replace secrets with `{{PLACEHOLDER}}` syntax
- **Local secrets** — Store actual values in `secrets.local.json` (never committed)

```bash
# Scan tracked files for secrets
tuck secrets scan

# Set a secret value locally
tuck secrets set API_KEY "your-actual-key"
```

## Hooks

Run custom commands before/after operations:

```json
{
  "hooks": {
    "postRestore": "source ~/.zshrc"
  }
}
```

## Development

```bash
git clone https://github.com/Pranav-Karra-3301/tuck.git
cd tuck
pnpm install
pnpm build
pnpm test
```

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit PRs to the `main` branch.

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
  <sub>Made with love in San Francisco and State College</sub>
</div>
