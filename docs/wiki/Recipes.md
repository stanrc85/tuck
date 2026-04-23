# Recipes

Task-oriented cookbook. "I want to do X" — find the closest recipe and adapt.

## Contents

- [Set up a consumer host](#set-up-a-consumer-host)
- [Migrate from chezmoi / stow / yadm](#migrate-from-chezmoi--stow--yadm)
- [Share zsh config across macOS + Linux without breakage](#share-zsh-config-across-macos--linux-without-breakage)
- [Bootstrap a fresh dev VM in one command](#bootstrap-a-fresh-dev-vm-in-one-command)
- [Add a new tool to your `bootstrap.toml`](#add-a-new-tool-to-your-bootstraptoml)
- [Run `tuck update` on a schedule](#run-tuck-update-on-a-schedule)
- [Preview a potentially destructive sync](#preview-a-potentially-destructive-sync)

---

## Set up a consumer host

**Scenario:** you have one beefy workstation (kubuntu) that "owns" your dotfiles — it's where you edit them, and syncs originate from it. You also have a VM (kali) or a laptop or a loaner machine that should *pull and restore* dotfiles but should **never** push changes upstream. The consumer might edit files locally (e.g., install kali-specific tweaks) that you don't want to leak back.

**Pattern:** `readOnlyGroups` in the shared config + `defaultGroups` in the per-host local config.

### 1. On every host — declare its role locally

```bash
# On kubuntu (producer)
tuck config set defaultGroups '["kubuntu"]'    # writes to .tuckrc.local.json

# On kali (consumer)
tuck config set defaultGroups '["kali"]'
```

`tuck config set` routes `defaultGroups` to `.tuckrc.local.json` automatically — the shared `.tuckrc.json` stays untouched, so this doesn't need to be pushed back.

### 2. From the producer — declare consumer groups

```bash
# On kubuntu, edit the shared .tuckrc.json
tuck config set readOnlyGroups '["kali"]'      # this writes to .tuckrc.json (shared)
tuck sync                                       # push the config change so every host sees it
```

### 3. Tag files for each role

```bash
# Producer-only files (work stuff, kubuntu-specific binds)
tuck group add kubuntu ~/.config/kubuntu-specific-thing

# Consumer-only files (kali-specific paths)
# Do this on the kali host first, since files only exist there
tuck add ~/.kali-rc -g kali
```

Files tagged with both groups (or with `shared`, or no group — all groups are just labels) apply everywhere. Per-group tags are what restrict scope.

### 4. Verify

```bash
# On kali
tuck sync
# → Error: HostReadOnlyError: Host is a member of read-only group 'kali'.
#   Run `tuck update` to pull latest dotfiles, or pass --force-write.

# This is correct. Consumers use `tuck update` (pull-only), not `tuck sync`.
tuck update
```

### Escape hatches

When you legitimately need to write from the consumer (fixing something while traveling, one-off push):

```bash
tuck sync --force-write                         # one invocation
TUCK_FORCE_WRITE=true tuck add ~/.something-new  # env var for a whole session
```

See [Host Groups — Consumer-host mode](./Host-Groups#consumer-host-mode) for the full story.

---

## Migrate from chezmoi / stow / yadm

The general shape works the same for all three — the specifics of "where are my tracked files now" differ.

### From chezmoi

```bash
# 1. Find where chezmoi stored the source files
chezmoi source-path ~/.zshrc
# → /home/you/.local/share/chezmoi/dot_zshrc

# 2. Restore the file back to its original path (chezmoi applies templating you'll want to resolve)
chezmoi apply --dry-run      # see what would change; if happy, drop --dry-run
chezmoi apply

# 3. Initialize tuck (separate repo — don't reuse chezmoi's repo)
tuck init
# → picks provider, creates tuck repo, scans system

# 4. Let tuck's scan find the now-resolved dotfiles
# During init's checkbox picker, select the files you want tracked.
# Alternatively, run `tuck scan` and `tuck add <paths>` manually.

# 5. Once tuck is tracking what you want, you can remove the chezmoi repo
rm -rf ~/.local/share/chezmoi
```

### From stow

Stow uses symlinks — each "package" lives under a directory like `~/dotfiles/zsh/.zshrc` that's symlinked into `~/.zshrc`.

```bash
# 1. Unstow everything (replaces symlinks with copies)
cd ~/dotfiles && stow -D */

# 2. Now ~/.zshrc etc. are real files. Init tuck and track them.
tuck init
```

If you have deeply-nested stowed directories, step 1 might want scripting. Run `stow -D <package>` one at a time if needed.

### From yadm

yadm tracks dotfiles in place via a bare git repo. Since the files are already at their source paths, the migration is simpler:

```bash
# 1. Export the list of tracked files
yadm ls-files > /tmp/yadm-tracked.txt

# 2. Init tuck
tuck init

# 3. Add each file
while read f; do
  tuck add "$HOME/$f"
done < /tmp/yadm-tracked.txt

# 4. Verify + sync
tuck status
tuck sync

# 5. Decommission yadm (keeps the bare repo as a backup until you're sure)
mv ~/.local/share/yadm ~/.local/share/yadm.bak
```

For templated yadm (`##os.Linux`, `##class.work`) — tuck's equivalent is [host groups](./Host-Groups). Manually recreate the splits with `tuck group add <group> <paths>`.

---

## Share zsh config across macOS + Linux without breakage

**The problem:** you want the same `.zshrc` on both, but `/usr/local/bin/brew` exists on Mac and doesn't on Linux, `ls --color=auto` fails on Mac (BSD `ls`), and Linuxbrew's path is different again.

**Two patterns, pick based on how much divergence.**

### Pattern A — guards inside a single shared file

Good when the per-OS diff is <20 lines.

```zsh
# ~/.zshrc — tracked once, works everywhere

# OS-neutral setup
export EDITOR=nvim
alias ll='ls -lah'

# macOS-only
if [[ "$OSTYPE" == "darwin"* ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
  alias ls='ls -G'
fi

# Linux-only
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  alias ls='ls --color=auto'
  [ -d "$HOME/.linuxbrew" ] && eval "$($HOME/.linuxbrew/bin/brew shellenv)"
fi
```

Track the single `.zshrc`; tag it with both groups:

```bash
tuck add ~/.zshrc -g mac -g linux
```

### Pattern B — separate files per OS, stitched via `source`

Good when divergence is substantial or you want cleaner per-OS history.

```zsh
# ~/.zshrc — tracked once, tiny stub
source ~/.zshrc.common

case "$OSTYPE" in
  darwin*)    [ -f ~/.zshrc.mac ]    && source ~/.zshrc.mac ;;
  linux-gnu*) [ -f ~/.zshrc.linux ]  && source ~/.zshrc.linux ;;
esac
```

Then track the per-OS files in their respective groups:

```bash
# On mac
tuck add ~/.zshrc.common -g mac -g linux
tuck add ~/.zshrc.mac -g mac

# On linux (same repo, different host)
tuck add ~/.zshrc.linux -g linux
```

`tuck restore` on Mac skips `.zshrc.linux` (not in the `mac` group) and vice versa. The stub at `~/.zshrc` is in both groups and gets applied everywhere.

---

## Bootstrap a fresh dev VM in one command

**Scenario:** brand new VM, SSH'd in, you want a working dev setup in under 10 minutes.

```bash
# 1. Install tuck
curl -fsSL https://raw.githubusercontent.com/stanrc85/tuck/main/install.sh | bash

# 2. Pull your dotfiles + restore + bootstrap your tool bundle — one shot
tuck init --from github.com/you/dotfiles
tuck restore --all --bootstrap

# Where --bootstrap runs `tuck bootstrap --bundle <current-host's-group>` inline
# after restoring the dotfiles.
```

If you want a specific bundle rather than the auto-picked one:

```bash
tuck restore --all
tuck bootstrap --bundle devbox
```

For scripting (CI provisioning, Packer / cloud-init templates), pass `--yes` to both:

```bash
tuck init --from github.com/you/dotfiles --yes
tuck restore --all --yes
tuck bootstrap --bundle devbox --yes
```

`--yes` on bootstrap pre-checks `sudo -n true` so the run fails fast if NOPASSWD isn't configured instead of hanging indefinitely on a password prompt.

---

## Add a new tool to your `bootstrap.toml`

Let's say you want `tealdeer` (`tldr` command) in your bootstrap catalog.

### 1. Find or create `~/.tuck/bootstrap.toml`

If it doesn't exist:

```bash
cp "$(npm root -g)/@prnv/tuck/templates/bootstrap.toml.example" ~/.tuck/bootstrap.toml
```

### 2. Add a `[[tool]]` entry

```toml
[[tool]]
id = "tealdeer"
description = "tldr pages client (fast, Rust)"
category = "shell"
requires = []
check = "command -v tldr >/dev/null 2>&1"
install = """
curl -fsSL -o /tmp/tealdeer \
  "https://github.com/dbrgn/tealdeer/releases/download/v${VERSION}/tealdeer-${OS}-${ARCH}-musl"
chmod +x /tmp/tealdeer
sudo mv /tmp/tealdeer /usr/local/bin/tldr
"""
update = "@install"
version = "1.7.0"
detect = { rcReferences = ["tldr"] }
```

Key points:

- `${VERSION}` pulls from the `version` field — bump `version = "1.7.1"` when upstream ships a new release and the next `tuck bootstrap --rerun tealdeer` installs it.
- `${OS}` and `${ARCH}` are tuck-interpolated — `${ARCH}` maps to Debian-style (`amd64`/`arm64`/`armhf`). If the release asset uses a different ARCH naming, build a per-URL translator in a small sh block before the curl.
- `detect.rcReferences` tells the picker "if any tracked shell dotfile mentions `tldr`, pre-check this tool." That way, on a fresh host you `tuck restore`'d your `.zshrc` onto, the picker already has tealdeer ticked.
- `update = "@install"` re-runs the install block. Handy when the install itself is a `curl | tar` — the script is the same for first-install and upgrade.

### 3. Add it to a bundle

```bash
tuck bootstrap bundle add devbox tealdeer
```

Or hand-edit `[bundles]` in `bootstrap.toml`.

### 4. Test on a fresh host

```bash
tuck bootstrap --tools tealdeer --dry-run    # verify the plan
tuck bootstrap --tools tealdeer              # actually install
tldr tuck                                     # verify it works
```

See [Bootstrapping Tools](./Bootstrapping-Tools) for every field documented.

---

## Run `tuck update` on a schedule

Keep every host current without thinking about it. One cron entry per host; `tuck update` handles self-update, dotfile pull, restore, and bootstrap updates in one pass.

### cron (macOS / Linux)

```cron
# Run daily at 09:00 local; log to a file you can tail
0 9 * * * /usr/local/bin/tuck update --yes >> ~/.tuck/update.log 2>&1
```

Key flags:
- `--yes` — non-interactive; accept every prompt including sudo pre-checks.
- Log redirection is important — cron silently swallows stderr by default.

Watch for **`TUCK_UPDATE_RESUMED=1`** in the logs after a self-update: that's the loop guard confirming tuck re-execed the freshly-installed binary and continued the pull/restore/tools phases under the new code.

### systemd timer

`~/.config/systemd/user/tuck-update.service`:

```ini
[Unit]
Description=tuck update (dotfiles + tools refresh)

[Service]
Type=oneshot
ExecStart=%h/.local/bin/tuck update --yes
StandardOutput=append:%h/.tuck/update.log
StandardError=append:%h/.tuck/update.log
```

`~/.config/systemd/user/tuck-update.timer`:

```ini
[Unit]
Description=Run tuck update daily

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:

```bash
systemctl --user daemon-reload
systemctl --user enable --now tuck-update.timer
systemctl --user list-timers | grep tuck
```

### On consumer hosts

Remember: on hosts in `readOnlyGroups`, `tuck sync` is blocked but `tuck update` is specifically the pull-only path. `tuck update` on a consumer host does self-update → git-pull → restore → bootstrap-update. No writes propagate upstream. This is the whole point of consumer mode.

---

## Preview a potentially destructive sync

Before running a `tuck sync` that might clobber something you forgot you'd edited, stack two preview commands:

```bash
# 1. What files would the sync touch?
tuck sync --list

# 2. What would change in each of them? (side-by-side with syntax highlighting)
tuck diff -s
```

`tuck sync --list` prints the scope (which host-group) and every file that would be modified or untracked, with group tags. No writes happen.

`tuck diff -s` shows the system-vs-repo diff for every currently-changed file in two columns with `|`/`+`/`-` markers. Syntax highlighting covers shell, JSON, YAML, TOML, Lua. Unchanged runs longer than 6 lines collapse to a ruler so the output stays compact even on large files.

If both look right, run the real sync:

```bash
tuck sync
```

If something looks wrong:

- Scope wrong? Fix the tags: `tuck group rm <group> <path>` or `tuck group add <group> <path>`.
- Content drift you didn't expect? `tuck restore <path>` pulls the repo version back onto the host, reverting your local edit. Or `tuck diff <path>` alone to read the full diff in detail.
- Accidentally staged deletion (file missing on disk but tuck would untrack it)? Check if you renamed or moved the file; tuck only sees "source path doesn't exist" and assumes you meant to untrack. Restore from [time machine](./Time-Machine-and-Undo) if needed.

## See also

- [Getting Started](./Getting-Started)
- [Host Groups](./Host-Groups)
- [Bootstrapping Tools](./Bootstrapping-Tools)
- [Time Machine & Undo](./Time-Machine-and-Undo)
