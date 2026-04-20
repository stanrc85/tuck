<div align="center">
  <img src="public/tuck.png" alt="tuck logo" width="180">
  
  # tuck
  
  **The modern dotfiles manager**
  
  Simple, fast, and beautiful. Manage your dotfiles with Git, sync across machines, and never lose your configs again.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/stanrc85/tuck/actions/workflows/ci.yml/badge.svg)](https://github.com/stanrc85/tuck/actions/workflows/ci.yml)

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

This fork is not published to npm. Install via the install script, the release
tarball, or a prebuilt standalone binary:

```bash
# One-liner install script (auto-detects platform, downloads binary + verifies SHA256)
curl -fsSL https://raw.githubusercontent.com/stanrc85/tuck/main/install.sh | bash

# Or install the latest release via npm (tarball ships pre-built, no local build needed)
npm install -g https://github.com/stanrc85/tuck/releases/latest/download/tuck.tgz

# Pin to a specific release
npm install -g https://github.com/stanrc85/tuck/releases/download/v1.0.2/tuck.tgz

# Or grab a prebuilt standalone binary
# → https://github.com/stanrc85/tuck/releases
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

# Install the CLI tools your dotfiles expect
tuck bootstrap --bundle <your-bundle>
```

## Commands

### Essential (what you'll use 99% of the time)

| Command       | Description                                                             |
| ------------- | ----------------------------------------------------------------------- |
| `tuck init`   | Set up tuck - scans for dotfiles, select what to track, syncs to GitHub |
| `tuck sync`   | Detect changes + new files, commit, and push (pulls first if behind; `-g` to scope to a host-group) |
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
| `tuck clean`                 | Remove orphaned files from `.tuck/files/` no longer in the manifest   |

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
| `tuck undo`         | Roll back any destructive op (apply, restore, sync, remove, clean)           |

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

### Maintenance

| Command                    | Description                                                                |
| -------------------------- | -------------------------------------------------------------------------- |
| `tuck self-update`         | Update tuck to the latest GitHub release of `stanrc85/tuck`                |
| `tuck bootstrap`           | Install CLI tools declared in `bootstrap.toml` (and a built-in set)        |
| `tuck bootstrap update`    | Re-run the `update` block for tools previously installed via `bootstrap`   |
| `tuck update`              | One-shot umbrella: self-update → pull dotfiles → restore → bootstrap update |

`tuck self-update` flags:
- `--check`: Report update status without installing (exit 1 if an update is available, 0 if up to date — handy for scripts)
- `-y`, `--yes`: Apply the update without prompting
- `--tag <tag>`: Install a specific release tag (e.g. `--tag v1.2.0`), including older tags for a downgrade/pin

`tuck bootstrap` flags:
- `--all`: Install every tool in the merged catalog (skip the picker)
- `--bundle <name>`: Install a named bundle from `[bundles]` (skip the picker)
- `--tools <ids>`: Comma/space-separated list of tool ids to install (skip the picker)
- `--rerun <ids>`: Force-reinstall specific tools, ignoring their `check` probe
- `--dry-run`: Print the resolved install order without executing anything
- `-y`, `--yes`: Pre-check `sudo -n true` when the script needs sudo so non-interactive runs fail fast instead of hanging on a password prompt
- `--no-detect`: In the picker, show a flat alphabetical list and ignore detection signals
- `-f`, `--file <path>`: Use a `bootstrap.toml` at a custom location (default: `~/.tuck/bootstrap.toml`)

`tuck bootstrap update` flags:
- `--all`: Update every installed tool (skip the picker)
- `--tools <ids>`: Comma/space-separated list of tool ids to update (skip the picker)
- `--check`: Report which installed tools have pending updates (version bump or definition drift) without doing anything; exit 1 if any are pending, 0 otherwise
- `--dry-run`: Print the planned update order without executing
- `-y`, `--yes`: Same sudo pre-check as `tuck bootstrap`
- `-f`, `--file <path>`: Alternate `bootstrap.toml` location

The picker shows only tools present in the install state file (`~/.tuck/.bootstrap-state.json`). Tools with pending updates are pre-selected; fully up-to-date tools can still be force-updated by toggling them on. Tools in state but missing from the current catalog are flagged as orphaned and skipped (no definition = nothing to run).

`tuck update` flags:
- `--no-self`: Skip the `tuck self-update` phase
- `--no-pull`: Skip the `git pull` phase on `~/.tuck/`
- `--no-restore`: Skip the `tuck restore --all` phase (which is itself only run when the pull brought in new commits)
- `--no-tools`: Skip the `tuck bootstrap update --all` phase
- `-y`, `--yes`: Forward `--yes` to both self-update and bootstrap update

When the self-update phase applies a new version, `tuck update` re-execs the freshly-installed binary with `--no-self` so the remaining phases (pull / restore / tools) run under the new code, not the stale in-memory copy. The re-exec carries forward every other flag and sets `TUCK_UPDATE_RESUMED=1` as a loop guard.

Under the hood `tuck self-update` runs `sudo npm install -g https://github.com/stanrc85/tuck/releases/download/<tag>/tuck.tgz` (or without `sudo` when already root or on Windows). Running from a dev checkout is refused — use `git pull && pnpm build` in that case.

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

If you omit `-g` on `tuck add`, the file is tagged with `config.defaultGroups` (set via `tuck migrate`), falling back to your machine's hostname. Set a sensible default once and most `tuck add` calls won't need the flag.

**Host-specific config lives in `~/.tuck/.tuckrc.local.json`**, which is gitignored by default. The shared `.tuckrc.json` can be committed to your dotfiles repo and pulled on every host without leaking per-host values like `defaultGroups`. Load order: defaults → `.tuckrc.json` (shared) → `.tuckrc.local.json` (host). The local file wins per-field. `tuck migrate` writes `defaultGroups` to the local file automatically.

**Allowed fields in `.tuckrc.local.json`** (strict schema rejects anything else):

- `defaultGroups` — per-host groups auto-applied when `-g` is omitted.
- `hooks` — per-host hook overrides (`preSync`, `postSync`, `preRestore`, `postRestore`). Each hook type is merged independently: a `postRestore` set in the local file replaces the shared `postRestore`, but leaves the other three hooks falling through to `.tuckrc.json`. Lets one host run a kali-only post-restore step without inlining `hostname`-gated shell in the shared command.

```json
// ~/.tuck/.tuckrc.local.json on the kali host
{
  "defaultGroups": ["kali"],
  "hooks": {
    "postRestore": "sed -i 's|snippet.toml|snippet-kali.toml|' ~/.config/pet/config.toml"
  }
}
```

If you're upgrading from a setup where `defaultGroups` is already committed inside the shared `.tuckrc.json`, migrate each host by hand:

```bash
# On each host — write this host's group to the local (gitignored) file
echo '{"defaultGroups": ["kali"]}' > ~/.tuck/.tuckrc.local.json

# Add the local filename to the repo's .gitignore (keeps it untracked)
grep -qxF '.tuckrc.local.json' ~/.tuck/.gitignore \
  || echo '.tuckrc.local.json' >> ~/.tuck/.gitignore

# Edit ~/.tuck/.tuckrc.json and delete the defaultGroups line (leave other
# shared settings like hooks/ignore in place), then commit + push the
# shared change once from any host so every host picks it up on next sync.
```

Every group-aware command honors `config.defaultGroups` the same way: on a host where `defaultGroups = ["kali"]`, bare invocations of `tuck sync`, `tuck restore`, `tuck apply`, `tuck list`, and `tuck diff` all scope to kali-tagged files automatically. Pass `-g <name>` to override. Pass `tuck diff <path>` / `tuck restore <path>` with an explicit path to bypass the scope for that one file.

For `tuck sync` specifically, this also fixes a data-loss corner case: files tagged for other hosts are no longer mis-flagged as deleted just because their source doesn't exist on this machine.

Unsure what a sync would touch? Run `tuck sync --list` first. It prints the scope, every tracked file that would be modified or untracked, and its group tags — no writes, no commit, no push.

```bash
$ tuck sync --list
tuck sync — preview

ℹ Scoped to host-group: kali

3 files would be synced:
  ~ ~/.zshrc [kali]
  ~ ~/.gitconfig [kali, shared]
  - ~/.oldrc [kali] (source missing — would untrack)
```

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

## Cleaning Orphaned Files

Over time, `.tuck/files/` can drift out of sync with the manifest — usually when `tuck remove` didn't clean up a mirrored copy, or files were moved manually. Use `tuck clean` to find and remove them safely:

```bash
# Preview what would be removed (never deletes)
tuck clean --dry-run

# Interactive — shows the full list + sizes, then prompts to confirm
tuck clean

# Skip the prompt
tuck clean -y

# Clean + commit in one shot
tuck clean --commit

# Clean + commit + push
tuck clean --push
```

Before any deletion, `tuck clean` prints every orphan file (with its size) and every directory that will be removed — and creates a time-machine snapshot so you can recover with `tuck undo`. `tuck clean` also warns when a manifest entry's destination is missing from disk (run `tuck doctor` to diagnose those).

## Time Machine & Undo

tuck takes an automatic snapshot of any files it's about to overwrite or delete, so you can always roll back. Snapshots live in `~/.tuck-backups/` — **outside** the synced `~/.tuck/` repo so they stay per-host and never leak across machines. Each snapshot is tagged with the operation that created it:

| Kind      | Created before                                                           |
| --------- | ------------------------------------------------------------------------ |
| `apply`   | `tuck apply` overwrites host files                                       |
| `restore` | `tuck restore` overwrites host files                                     |
| `sync`    | `tuck sync` overwrites the repo-side copies of modified tracked files    |
| `remove`  | `tuck remove --delete` / `--push` deletes a repo-side copy               |
| `clean`   | `tuck clean` removes orphaned files from the repo                        |
| `manual`  | Ad-hoc snapshot (e.g. via the programmatic API)                          |

```bash
# List every snapshot (kind + date + file count)
tuck undo --list

# Interactive pick-one
tuck undo

# Restore the latest
tuck undo --latest

# Restore a specific snapshot by ID
tuck undo 2026-04-18-143022

# Restore a single file from a snapshot
tuck undo 2026-04-18-143022 --file ~/.zshrc

# Delete a snapshot
tuck undo --delete 2026-04-18-143022
```

### Retention

Snapshots are pruned automatically after each new one is created. Defaults keep the 50 newest snapshots and drop anything older than 30 days. Tune it in `~/.tuck/.tuckrc.json`:

```json
{
  "snapshots": {
    "maxCount": 50,
    "maxAgeDays": 30
  }
}
```

Set either value to `0` to disable that dimension.

## Bootstrapping Tools

`tuck bootstrap` installs CLI tools on a fresh machine from a declarative catalog. Think of it as the orchestration half of "new-machine setup" — dotfiles come from `tuck apply` / `tuck restore`; the CLIs those dotfiles expect come from `tuck bootstrap`.

### Quick start

```bash
# Interactive picker — detected tools pre-checked
tuck bootstrap

# See the plan without running anything
tuck bootstrap --all --dry-run

# Install one or more tools by id
tuck bootstrap --tools neovim,pet

# Install a named bundle
tuck bootstrap --bundle kali
```

### Built-in catalog

These come with tuck and don't need anything in your `bootstrap.toml`:

| Tool              | Source                                                                 | Notes                                                     |
| ----------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `fzf`             | `apt` package                                                          | Fuzzy finder                                              |
| `eza`             | `apt` package (Debian trixie / Ubuntu 24.04+)                          | Modern `ls` replacement                                   |
| `bat`             | `apt` package + `batcat → bat` symlink                                 | Symlinks to `/usr/local/bin` if sudo cached, else `~/.local/bin` |
| `fd`              | `apt` package (`fd-find`) + `fdfind → fd` symlink                      | Same symlink pattern as `bat` (sudo-cached vs `~/.local/bin`)    |
| `neovim`          | `apt` package                                                          | Editor                                                    |
| `neovim-plugins`  | `nvim --headless` with lazy.nvim sync + treesitter parser install      | Requires `neovim`. Install is heavy (first-run cold compile); update is just `Lazy! sync` |
| `pet`             | `curl` from GitHub release `.deb` + `dpkg -i`                          | Version-pinned. Snippet manager (`knqyf263/pet`)          |
| `yazi`            | `curl` from GitHub release zip, extract to `/usr/local/bin` or `~/.local/bin` | Version-pinned. Terminal file manager (`sxyazi/yazi`) |

Disable a built-in with `[registry] disabled = [...]` or override it by defining your own `[[tool]]` with the same `id` — user tools always win.

### Your own `bootstrap.toml`

`bootstrap.toml` is **optional** — if the file doesn't exist, `tuck bootstrap` just uses the built-in registry above. Create one only when you want to add your own tools, define bundles, or disable built-ins. Two annotated examples ship with tuck:

```bash
# Minimal starter — field reference + a couple of canned examples
cp "$(npm root -g)/@prnv/tuck/templates/bootstrap.toml.example" ~/.tuck/bootstrap.toml

# Full Debian/Ubuntu/Kali dev-workstation setup — bulk apt tier, Node
# toolchain, tealdeer, ZimFW, zsh-fzf-history-search, chsh helper, plus
# ready-to-use `kali` / `full` / `minimal` bundles
cp "$(npm root -g)/@prnv/tuck/templates/bootstrap.toml.full.example" ~/.tuck/bootstrap.toml
```

Minimal shape:

```toml
[[tool]]
id = "ripgrep"
description = "recursive grep"
category = "shell"
requires = []                              # other tool ids this one needs first
check = "command -v rg >/dev/null 2>&1"    # exit 0 = already installed, skip
install = "sudo apt-get install -y ripgrep"
update = "sudo apt-get install -y --only-upgrade ripgrep"
detect = { paths = [], rcReferences = ["rg"] }   # picker hints

[[tool]]
id = "my-custom-tool"
description = "something local"
version = "2.1.0"                           # interpolated as ${VERSION}
install = """
curl -fsSL https://example.com/tool-v${VERSION}-${OS}-${ARCH}.tar.gz | tar -xz -C /tmp
mv /tmp/tool /usr/local/bin/
"""
update = "@install"                         # @install or omitted → re-run install

[bundles]
kali      = ["ripgrep", "fzf", "pet", "neovim", "neovim-plugins"]
minimal   = ["ripgrep", "fzf"]
```

### Variable interpolation

Exactly five tokens are substituted in `check`, `install`, and `update` strings:

| Token          | Value                                                             |
| -------------- | ----------------------------------------------------------------- |
| `${VERSION}`   | The tool's `version` field (throws if referenced and unset)       |
| `${ARCH}`      | `amd64` / `arm64` / `armhf` (Debian-style; from `os.arch()`)      |
| `${OS}`        | `linux` / `darwin` / `windows`                                    |
| `${HOME}`      | User home directory                                               |
| `${TUCK_DIR}`  | Absolute path to the tuck data directory                          |

Anything else — `${PATH}`, `$(uname -m)`, `$HOME` — passes through untouched so the shell expands it at run time. tuck deliberately does **not** do arbitrary env-var reach-through.

### Dependencies and order

`requires` targets are resolved transitively. Pick `neovim-plugins` and `neovim` is pulled in automatically, installed first, and tagged `(dep)` in the output. Cycles and unknown ids fail fast with the participating tool names in the error.

### State and drift detection

Successful installs are recorded in `~/.tuck/.bootstrap-state.json` (per-host; never synced) with a SHA-256 hash of the normalized tool definition. If the definition changes in a later tuck release (or in your `bootstrap.toml`), the picker surfaces the tool as "outdated." Re-run with `--rerun <id>` to force a reinstall ignoring its `check` probe.

### Sudo handling

Every `sudo <cmd>` line prompts interactively as usual. Under `--yes`, tuck pre-checks `sudo -n true` whenever the script contains `sudo` — if credentials aren't cached, you get one clear error ("run `sudo -v` first, or configure NOPASSWD") instead of a mystery hang.

### Failure containment

A single tool's install failing doesn't abort the run. Dependents of a failed tool are marked `skipped-dep-failed` and the loop continues. Final summary reports `N installed, M failed, K skipped` with per-tool detail, and tuck exits non-zero if anything failed so CI pipelines catch it.

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
  "snapshots": {
    "maxCount": 50,
    "maxAgeDays": 30
  },
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
git clone https://github.com/stanrc85/tuck.git
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
