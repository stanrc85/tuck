# Command Reference

Every `tuck` command, with synopsis, flags, and worked examples. Use **Ctrl-F** to jump to a command. For the why-and-when, see the topic pages linked at the bottom of each entry.

## Contents

- **Essential**
  - [tuck init](#tuck-init)
  - [tuck sync](#tuck-sync)
  - [tuck status](#tuck-status)
- **Managing files**
  - [tuck add](#tuck-add)
  - [tuck remove](#tuck-remove)
  - [tuck scan](#tuck-scan)
  - [tuck list](#tuck-list)
  - [tuck diff](#tuck-diff)
  - [tuck ignore](#tuck-ignore)
  - [tuck group](#tuck-group)
  - [tuck migrate](#tuck-migrate)
  - [tuck clean](#tuck-clean)
- **Syncing**
  - [tuck push](#tuck-push)
  - [tuck pull](#tuck-pull)
- **Restoring**
  - [tuck apply](#tuck-apply)
  - [tuck restore](#tuck-restore)
  - [tuck undo](#tuck-undo)
- **Cheatsheet**
  - [tuck cheatsheet](#tuck-cheatsheet)
- **Configuration**
  - [tuck config](#tuck-config)
- **Diagnostics**
  - [tuck doctor](#tuck-doctor)
  - [tuck validate](#tuck-validate)
  - [tuck optimize](#tuck-optimize)
- **Maintenance**
  - [tuck self-update](#tuck-self-update)
  - [tuck bootstrap](#tuck-bootstrap)
  - [tuck bootstrap update](#tuck-bootstrap-update)
  - [tuck bootstrap bundle](#tuck-bootstrap-bundle)
  - [tuck update](#tuck-update)
- **Secrets**
  - [tuck secrets](#tuck-secrets)

---

## Essential

### tuck init

Interactive single-command setup. Creates `~/.tuck/`, picks a git provider, scans for dotfiles, and does the first commit + push.

**Synopsis**

    tuck init [options]

**Options**

- `--from <url-or-slug>` — clone from an existing repo instead of starting fresh. Accepts GitHub slugs (`user/repo`), full URLs, or SSH URLs.
- `-y, --yes` — accept the defaults at every prompt (useful for CI / automated installs).
- `--skip-scan` — skip the dotfile auto-discovery step. You'll start with an empty tracked-set and add files manually.

**Examples**

    # Fresh setup, interactive
    tuck init

    # Restore on a new machine by pointing at your dotfiles repo
    tuck init --from github.com/you/dotfiles
    tuck restore --all

    # Non-interactive defaults (local-only, scan all, no remote)
    tuck init --yes

**See also:** [Getting Started](./Getting-Started), [Git Providers](./Git-Providers)

---

### tuck sync

The one-command loop for pushing changes: pull (rebase+autostash) → detect changes in tracked sources → commit → push.

**Synopsis**

    tuck sync [options]

**Options**

- `-g, --group <name>` — scope the sync to files tagged with this host-group (repeatable). Falls back to `config.defaultGroups` when omitted.
- `-m, --message <msg>` — custom commit message. Default: `tuck sync: <N> files`.
- `--list` — preview-only: print the scope + every file that would be synced + its group tags, then exit. No writes, no commit, no push.
- `--no-push` — commit locally but skip the push. Useful when you want to stage several syncs and push once.
- `--force-write` — bypass the consumer-host guard (`readOnlyGroups`). See [Host Groups](./Host-Groups#consumer-host-mode).
- `--category <cat>` — scope to one category (`shell`, `git`, `editors`, `terminal`, `ssh`, `misc`).

**Examples**

    # Full loop
    tuck sync

    # Preview first (no writes)
    tuck sync --list

    # Scope to the kali host-group only
    tuck sync -g kali

    # Custom commit message
    tuck sync -m "chore: rotate ssh config on work host"

    # Stage several syncs, push once
    tuck sync --no-push
    tuck sync --no-push
    tuck push

**Behavior notes**

- `tuck sync` performs `git pull --rebase --autostash` before doing anything else, so a dirty repo working tree won't block the run.
- If the current host is in `readOnlyGroups`, sync refuses with `HostReadOnlyError` unless you pass `--force-write`. The whole host-group model is a feature; read about it in [Host Groups](./Host-Groups#consumer-host-mode).
- The repo never silently untracks files whose source is missing on this host — that's a host-group misconfiguration, not a deletion. Run `tuck sync --list` to see what would change.

**See also:** [Host Groups](./Host-Groups), [tuck status](#tuck-status), [tuck diff](#tuck-diff)

---

### tuck status

Show what's tracked, what's changed, and whether the repo is in sync with the remote.

**Synopsis**

    tuck status [options]

**Options**

- `-g, --group <name>` — scope the output to one host-group.
- `--category <cat>` — scope to one category.
- `-v, --verbose` — include unchanged files.

**Examples**

    tuck status
    tuck status -g work
    tuck status --category shell

**See also:** [tuck diff](#tuck-diff), [tuck sync](#tuck-sync)

---

## Managing files

### tuck add

Start tracking one or more files. Files are copied from their source path into `~/.tuck/files/<category>/` and an entry is added to the manifest.

**Synopsis**

    tuck add <paths...> [options]

**Options**

- `-g, --group <name>` — tag the added file(s) with this host-group (repeatable). Defaults to `config.defaultGroups`.
- `--category <cat>` — override the auto-detected category.
- `--symlink` — create a symlink from the source path to the repo copy instead of the default copy strategy. See [Configuration Reference](./Configuration-Reference#file-strategies).

**Examples**

    tuck add ~/.zshrc ~/.gitconfig
    tuck add ~/.ssh/config -g work
    tuck add ~/.config/starship.toml -g work -g personal

**See also:** [tuck scan](#tuck-scan), [tuck group](#tuck-group)

---

### tuck remove

Stop tracking files. The source path on your host is **never** touched — only the repo copy and manifest entry are removed.

**Synopsis**

    tuck remove <paths...> [options]

**Options**

- `--delete` — also delete the file from `~/.tuck/files/`. Without this, the manifest entry is dropped but the repo copy stays.
- `--push` — implies `--delete`. Commits the deletion and pushes to the remote in one shot.
- `-m, --message <msg>` — custom commit message for the `--push` variant.
- `--force-write` — bypass the consumer-host guard.

**Examples**

    # Untrack but keep the repo copy (safer)
    tuck remove ~/.oldrc

    # Untrack + delete the repo copy
    tuck remove --delete ~/.oldrc

    # Untrack + delete + commit + push, all in one
    tuck remove --push ~/.oldrc

    # With a custom message
    tuck remove --push -m "chore: stop tracking legacy config" ~/.oldrc

**Behavior notes**

- If `--push` fails (network, auth), the commit stays local and tuck prompts to retry up to 3 times. Run `tuck push` later if you declined.
- Before deleting the repo copy, tuck takes a `remove` snapshot you can roll back via `tuck undo`.

**See also:** [tuck clean](#tuck-clean), [tuck undo](#tuck-undo)

---

### tuck scan

Discover dotfiles on your system without syncing. Prints a list of detected files by category.

**Synopsis**

    tuck scan [options]

**Options**

- `--category <cat>` — scope to one category.
- `--include-ignored` — include paths in `.tuckignore`.

**Examples**

    tuck scan
    tuck scan --category editors

**See also:** [tuck add](#tuck-add), [tuck ignore](#tuck-ignore)

---

### tuck list

List tracked files, grouped by category with group tags per file.

**Synopsis**

    tuck list [options]

**Options**

- `-g, --group <name>` — filter to one host-group (repeatable).
- `--category <cat>` — filter to one category.
- `--format <fmt>` — `table` (default), `json`, `paths` (one path per line for piping).

**Examples**

    tuck list
    tuck list -g kali
    tuck list --format paths | fzf    # fuzzy-pick a tracked file

**See also:** [tuck status](#tuck-status)

---

### tuck diff

Show differences between your system files and their repo copies. Useful before a sync to preview what would change.

**Synopsis**

    tuck diff [paths...] [options]

**Options**

- `-s, --side-by-side` — render in two columns with syntax highlighting (auto-falls back to unified on terminals narrower than 80 cols).
- `--stat` — git-style summary: `path | NN +++---` bar graph.
- `--name-only` — print just the changed file paths.
- `-g, --group <name>` — scope to a host-group.
- `--category <cat>` — scope to a category.
- `--staged` — show staged git changes in `~/.tuck/` instead of the system-vs-repo diff.
- `--exit-code` — return exit code 1 if differences found (for scripting).

**Examples**

    tuck diff                       # all changed files
    tuck diff ~/.zshrc              # one file
    tuck diff -s                    # side-by-side layout
    tuck diff --stat                # summary bar graph
    tuck diff --name-only | wc -l   # count changed files

**Behavior notes**

- Output automatically syntax-highlights shell (`.sh`/`.bash`/`.zsh`/`.zshrc`/`.bashrc`/…), JSON, YAML, TOML, and Lua when the file extension or basename is recognized. Unknown extensions render in the default diff colors without syntax. Colors respect your terminal theme — tuck only emits named ANSI codes, not RGB.
- Unchanged runs longer than 6 lines collapse to a dim `┄ N unchanged lines ┄` ruler so a 500-line `.zshrc` with one edit renders in ~10 rows.

**See also:** [tuck sync](#tuck-sync)

---

### tuck ignore

Manage `.tuckignore` — paths that `tuck scan` and `tuck add` skip automatically.

**Synopsis**

    tuck ignore add <paths...>
    tuck ignore rm <paths...>
    tuck ignore list

**Examples**

    tuck ignore add ~/.cache ~/.local/share
    tuck ignore list
    tuck ignore rm ~/.cache

**See also:** [tuck scan](#tuck-scan)

---

### tuck group

Manage host-group tags on tracked files. Every tracked file belongs to at least one group.

**Synopsis**

    tuck group add <group> <paths...>
    tuck group rm <group> <paths...>
    tuck group list
    tuck group show <group>

**Examples**

    tuck group add kali ~/.zshrc ~/.tmux.conf
    tuck group rm work ~/.zshrc         # keeps at least one group per file
    tuck group list                     # all groups + file counts
    tuck group show kali                # files in the kali group

**Behavior notes**

- `tuck group rm` refuses to remove the last remaining group from a file. Add a different group first.
- Group names are case-sensitive. `kali` and `Kali` are different groups.

**See also:** [Host Groups](./Host-Groups)

---

### tuck migrate

One-time: tag every existing file with a host-group. Required after upgrading from a pre-2.0 manifest that didn't have groups.

**Synopsis**

    tuck migrate [options]

**Options**

- `-g, --group <name>` — the group to tag all existing files with (repeatable). Defaults to the hostname if omitted in interactive mode.

**Examples**

    tuck migrate                  # interactive — prompts for the group name
    tuck migrate -g laptop        # non-interactive, single group
    tuck migrate -g laptop -g work  # multiple groups

**Behavior notes**

- Idempotent: running on an already-migrated manifest is a no-op.
- Every group-aware command errors with `MigrationRequiredError` until migrate is run.

**See also:** [Host Groups](./Host-Groups#migrating-from-1x)

---

### tuck clean

Remove orphaned files from `~/.tuck/files/` — files on disk that aren't in the manifest (usually because `tuck remove` didn't clean up a mirrored copy, or files were moved manually).

**Synopsis**

    tuck clean [options]

**Options**

- `--dry-run` — preview only. Print every orphan + size, don't delete.
- `-y, --yes` — skip the confirmation prompt.
- `--commit` — commit the cleanup in one step.
- `--push` — commit + push.
- `-m, --message <msg>` — custom commit message for `--commit` / `--push`.

**Examples**

    tuck clean --dry-run      # preview
    tuck clean                # interactive confirm
    tuck clean -y             # auto-confirm
    tuck clean --push         # clean + commit + push

**Behavior notes**

- Creates a `clean` snapshot before deletion so `tuck undo` can restore anything.
- Warns (but doesn't fail) when a manifest entry points at a destination missing from disk — that's usually a different class of drift; run `tuck doctor` to diagnose.

**See also:** [tuck remove](#tuck-remove), [tuck doctor](#tuck-doctor)

---

## Syncing

### tuck push

Push local commits in `~/.tuck/` to the remote. Called internally by `tuck sync`; useful manually when you've used `tuck sync --no-push`.

**Synopsis**

    tuck push [options]

**Options**

- `--force-write` — bypass consumer-host guard.

---

### tuck pull

Pull + rebase + autostash from the remote into `~/.tuck/`. Called internally by `tuck sync`.

**Synopsis**

    tuck pull [options]

---

## Restoring

### tuck apply

Apply another user's (or your own) dotfiles to the host. Smart-merges shell files to preserve local customizations.

**Synopsis**

    tuck apply <user-or-url> [options]

**Options**

- `-g, --group <name>` — pick one host-group from the source repo.
- `-y, --yes` — accept every overwrite prompt.
- `--no-backup` — skip the pre-apply snapshot (not recommended).
- `--install-deps` / `--no-install-deps` — control the post-apply missing-tool prompt.

**Examples**

    # Pull someone else's public dotfiles
    tuck apply octocat

    # Your own, scoped to a group
    tuck apply you/dotfiles -g work

**Behavior notes**

- Takes an `apply` snapshot before overwriting anything — `tuck undo` rolls back.
- After writing files, checks whether any tool in your bootstrap catalog configures those paths (via `associatedConfig` globs) but isn't installed (e.g. you restored `~/.config/nvim/` but don't have `nvim`). Interactive TTY: offers a y/n to run `tuck bootstrap --tools <missing>`. Non-interactive: silently skips unless `--install-deps`.

**See also:** [tuck restore](#tuck-restore), [Bootstrapping Tools](./Bootstrapping-Tools)

---

### tuck restore

Write tracked files from the repo back to your system.

**Synopsis**

    tuck restore [paths...] [options]

**Options**

- `--all` — restore every tracked file (required without explicit paths).
- `-g, --group <name>` — scope to one host-group.
- `--category <cat>` — scope to one category.
- `-y, --yes` — accept overwrite prompts.
- `--no-backup` — skip the pre-restore snapshot.
- `--install-deps` / `--no-install-deps` — control the missing-tool prompt (same semantics as `tuck apply`).
- `--bootstrap` — run the full bootstrap flow after restoring (installs the bundle associated with the current host's primary group, if any).

**Examples**

    # Full restore
    tuck restore --all

    # One file
    tuck restore ~/.zshrc

    # Just the kali group
    tuck restore -g kali --all

    # Restore + install matching tools
    tuck restore --all --bootstrap

**See also:** [tuck apply](#tuck-apply), [tuck undo](#tuck-undo)

---

### tuck undo

Roll back any destructive operation using time-machine snapshots.

**Synopsis**

    tuck undo [snapshot-id] [options]

**Options**

- `--list` — list every snapshot (kind, date, file count) and exit.
- `--latest` — restore the most recent snapshot without picking.
- `--file <path>` — restore only one file from the chosen snapshot.
- `--delete <id>` — delete a snapshot.

**Examples**

    tuck undo --list
    tuck undo                              # interactive pick-one
    tuck undo --latest
    tuck undo 2026-04-18-143022
    tuck undo 2026-04-18-143022 --file ~/.zshrc
    tuck undo --delete 2026-04-18-143022

**See also:** [Time Machine & Undo](./Time-Machine-and-Undo)

---

## Cheatsheet

### tuck cheatsheet

Walk the manifest, run format-specific parsers against each tracked file's content, and emit a markdown (or JSON) document listing every keybind, alias, and binding tuck could extract.

**Synopsis**

    tuck cheatsheet [options]

**Options**

- `-o, --output <path>` — write to a custom path. Default: `<tuckDir>/cheatsheet.md`.
- `--stdout` — print to stdout instead of writing. Handy for `tuck cheatsheet --stdout | less` or `| glow`.
- `--format <fmt>` — `markdown` (default) or `json`.
- `--sources <ids>` — restrict to specific parsers (e.g. `--sources tmux,zsh`).
- `-g, --group <name>` — filter tracked files by host-group.

**Supported parsers**

- **tmux** — `bind-key` / `bind` directives; picks up the `-N "note"` description where present.
- **zsh** — `bindkey` + `alias`.
- **yazi** — `keymap.toml` sections.
- **Neovim (lua)** — `vim.keymap.set` / `vim.api.nvim_set_keymap` with `opts.desc`.

Dynamic mappings (mode or lhs driven by a variable or loop) are silently skipped — only literal string arguments are captured.

**Examples**

    # Default — write to <tuckDir>/cheatsheet.md
    tuck cheatsheet

    # Stdout, tmux + zsh only
    tuck cheatsheet --stdout --sources tmux,zsh

    # JSON for downstream tooling
    tuck cheatsheet --format json -o ~/.cache/tuck-keys.json

**See also:** [Cheatsheet](./Cheatsheet) — consumer recipes (zsh+fzf picker, jq queries, etc).

---

## Configuration

### tuck config

View and edit configuration. Without arguments, drops into an interactive menu.

**Synopsis**

    tuck config
    tuck config get <key>
    tuck config set <key> <value>
    tuck config unset <key>
    tuck config remote
    tuck config wizard

**Examples**

    tuck config                              # interactive menu
    tuck config get repository.autoPush
    tuck config set repository.autoPush true
    tuck config set defaultGroups '["kali"]'
    tuck config remote                       # configure provider
    tuck config wizard                       # full re-run of init's prompts

**Behavior notes**

- `tuck config set` writes to the **shared** `.tuckrc.json` by default. Fields that must be per-host (`defaultGroups`, per-host `hooks`) write to `.tuckrc.local.json` automatically — no flag needed.
- Keys are dotted paths: `repository.autoPush`, `snapshots.maxCount`, `remote.mode`.
- `tuck config` refuses reserved key names (`__proto__`, `constructor`, `prototype`) at every dotted-path segment.

**See also:** [Configuration Reference](./Configuration-Reference), [Git Providers](./Git-Providers)

---

## Diagnostics

### tuck doctor

Run repository-health and safety diagnostics. Useful after upgrades or when something feels off.

**Synopsis**

    tuck doctor [options]

**Options**

- `--json` — machine-readable output for CI.
- `--strict` — treat warnings as non-zero exit.
- `--category <env|repo|manifest|security|hooks>` — run one check group.

**Examples**

    tuck doctor
    tuck doctor --category manifest
    tuck doctor --json --strict           # CI-style

**Check groups**

- **env** — tuck version, node version, git availability, provider CLI availability.
- **repo** — `~/.tuck/` exists, is a git repo, has a remote, remote reachable.
- **manifest** — every manifest entry's source and destination are sane, no orphans, no duplicates.
- **security** — secret-scanner patterns against tracked content.
- **hooks** — hook commands parse + referenced binaries exist.

---

### tuck validate

Syntax-check tracked files — JSON, TOML, shell (bash/zsh), Lua. Report-only by default; `--fix` previews + applies a narrow set of safe rewrites after confirmation.

**Synopsis**

    tuck validate [paths...] [options]

**Options**

- `--format <text|json>` — output format (default `text`). `json` emits `{ summary, results }` for scripting.
- `--fix` — preview trailing-whitespace + missing-EOF-newline fixes as a unified diff, then prompt `Apply fixes to N files?` before writing.
- `-y, --yes` — skip the confirmation prompt (still previews, still snapshots). Required in non-TTY / CI mode when `--fix` is set.

**Examples**

    tuck validate                         # validate every tracked file
    tuck validate ~/.zshrc ~/.tmux.conf   # validate a subset
    tuck validate --format json           # for CI — exit 1 on any failure
    tuck validate --fix                   # preview + confirm fixes
    tuck validate --fix -y                # non-interactive apply (CI)

**Validators**

- **JSON** — `JSON.parse` + line:col extraction from the error message.
- **TOML** — `smol-toml.parse`; surfaces `line` / `column` from `TomlError` when available.
- **Shell** — `bash -n` / `zsh -n` dispatched by filename. `.zsh`, `.zshrc`, `.zshenv`, `.zprofile`, `.zlogin`, `.zlogout` → zsh; everything else → bash. Warn-skips when the shell binary isn't installed.
- **Lua** — `luac -p`. Warn-skips when `luac` isn't on `$PATH`.

YAML is not validated today — tracked as a follow-up.

**Behavior notes**

- Exit code 1 if any file fails validation (so `tuck validate --format json` drops into CI as-is).
- `--fix` only handles trailing whitespace and missing EOF newline in this release. Mixed tab/space normalisation, JSON pretty-print, TOML pretty-print, and shellcheck integration are follow-ups.
- Before any write, `--fix` creates a Time Machine snapshot (`SnapshotKind: validate-fix`) so `tuck undo` can roll it back.
- Non-TTY invocation without `--yes` refuses to write — preview only. Guard against "CI silently fixed my files" surprise.

**See also:** [tuck doctor](#tuck-doctor), [tuck undo](#tuck-undo), [Time Machine & Undo](./Time-Machine-and-Undo)

---

### tuck optimize

Profile zsh startup and flag rule-based recommendations. Zsh-only for now. Report-only by default; `--auto` previews + applies the safe subset of fixes after confirmation.

**Synopsis**

    tuck optimize [options]

**Options**

- `--profile` — profile only, skip the recommendation engine. Prints per-source wall-clock attribution.
- `--auto` — preview + apply the safe subset of auto-fixes (today: append `skip_global_compinit=1` to `~/.zshenv` when `multiple-compinit` fires and the line isn't present).
- `-y, --yes` — skip the confirmation prompt (still previews, still snapshots). Required in non-TTY / CI mode when `--auto` is set.
- `--format <text|json>` — output format (default `text`). `json` emits structured recommendations for scripting.

**Examples**

    tuck optimize                         # profile + recommendations
    tuck optimize --profile               # timing attribution only
    tuck optimize --auto                  # preview + confirm auto-fixes
    tuck optimize --format json           # for scripting

**Profiler**

- Runs `zsh -ixc exit` with `PS4='+%D{%s.%6.}|%N|%i> '` — epoch seconds with 6-digit fractional precision + source file + line, pipe-delimited.
- Attributes each line's wall-clock delta to the previous event's source file.
- Output is a descending list of hot source files with aggregate time.

**Rules**

- **multiple-compinit** — `compinit` called more than once during startup. Recommends `skip_global_compinit=1` in `~/.zshenv`. Suppressed when that line is already present in any startup file.
- **duplicate-path** — the same directory appears more than once across `~/.zshenv`, `~/.zprofile`, `~/.zshrc`, `~/.zlogin`. Reads source files directly, not xtrace events (so repeated PATH entries inside functions don't false-positive).
- **sync-version-managers** — synchronous load of nvm / rbenv / pyenv at startup. Recommends a lazy-load pattern. Internal events from inside the manager's scripts don't count toward the trigger.
- **blocking-startup** — network / auth calls at shell start (`curl`, `wget`, `ssh`, `gpg`, `git pull`, `gh auth`, `op signin`). Uses first-token + multi-word phrase matching so mentions in comments or strings don't false-positive.

**Behavior notes**

- Bash profiling is a follow-up — `tuck optimize` currently requires zsh.
- `--auto` applies PATH dedup **only** as a suggestion today, not a rewrite — rewriting PATH across variable expansions, conditionals, and substitutions is easy to get wrong. Manual edit suggested in the report.
- Before any write, `--auto` creates a Time Machine snapshot (`SnapshotKind: optimize-auto`) so `tuck undo` can roll it back.
- Non-TTY invocation without `--yes` refuses to write.

**See also:** [tuck validate](#tuck-validate), [tuck undo](#tuck-undo), [Time Machine & Undo](./Time-Machine-and-Undo)

---

## Maintenance

### tuck self-update

Update tuck itself to the latest GitHub release of `stanrc85/tuck`.

**Synopsis**

    tuck self-update [options]

**Options**

- `--check` — report update status without installing. Exit 1 if an update is available, 0 if up to date. For scripts.
- `-y, --yes` — apply without prompting.
- `--tag <tag>` — install a specific tag (e.g. `--tag v1.2.0`). Works for downgrades / pins.

**Examples**

    tuck self-update --check
    tuck self-update -y
    tuck self-update --tag v1.2.0

**Behavior notes**

- Runs `sudo npm install -g https://github.com/stanrc85/tuck/releases/download/<tag>/tuck.tgz` (or without `sudo` when already root / on Windows).
- Refuses to run from a dev checkout — use `git pull && pnpm build` in that case.

**See also:** [tuck update](#tuck-update)

---

### tuck bootstrap

Install CLI tools on a fresh machine from a declarative catalog. The orchestration half of "new-machine setup" — dotfiles come from `tuck apply` / `tuck restore`; the CLIs those dotfiles expect come from `tuck bootstrap`.

**Synopsis**

    tuck bootstrap [options]

**Options**

- `--all` — install every tool in the merged catalog (skip the picker).
- `--bundle <name>` — install a named bundle from `[bundles]`.
- `--tools <ids>` — comma/space-separated tool ids to install.
- `--rerun <ids>` — force-reinstall, ignoring `check` probes.
- `--dry-run` — print the resolved install order without executing.
- `-y, --yes` — pre-check `sudo -n true` when the script needs sudo so non-interactive runs fail fast.
- `--no-detect` — in the picker, show a flat alphabetical list and ignore detection signals.
- `-f, --file <path>` — alternate `bootstrap.toml` location. Default: `~/.tuck/bootstrap.toml`.

**Examples**

    # Interactive picker — detected tools pre-checked
    tuck bootstrap

    # Plan the install, don't run anything
    tuck bootstrap --all --dry-run

    # Install specific tools
    tuck bootstrap --tools neovim,pet

    # Install a named bundle
    tuck bootstrap --bundle kali

    # Force-reinstall neovim even though `check` would skip it
    tuck bootstrap --rerun neovim

**See also:** [Bootstrapping Tools](./Bootstrapping-Tools) — full `bootstrap.toml` schema, built-in catalog, variable interpolation, failure containment.

---

### tuck bootstrap update

Re-run the `update` script for tools previously installed via `bootstrap`. Drives the picker from the per-host install state file.

**Synopsis**

    tuck bootstrap update [options]

**Options**

- `--all` — update every installed tool (skip the picker).
- `--tools <ids>` — update specific ids.
- `--check` — report which installed tools have pending updates (version bump or definition drift) without doing anything. Exit 1 if any are pending, 0 otherwise.
- `--dry-run` — print the planned update order without executing.
- `-y, --yes` — same sudo pre-check as `tuck bootstrap`.
- `-f, --file <path>` — alternate `bootstrap.toml`.

**Examples**

    tuck bootstrap update             # picker with pending updates pre-selected
    tuck bootstrap update --all
    tuck bootstrap update --check     # CI exit-code
    tuck bootstrap update --tools bat,fd

**Behavior notes**

- The picker shows only tools in `~/.tuck/.bootstrap-state.json`. Tools with pending updates are pre-selected; up-to-date tools can still be force-updated by toggling them on.
- Tools present in state but missing from the current catalog are flagged as orphaned and skipped.
- Tools tagged with `updateVia = "system"` (the six apt-managed built-ins: `bat`, `eza`, `fd`, `fzf`, `ripgrep`, `zsh`) are deferred by default under `--all` and the picker — the system package manager owns them. Use `--tools <id>` as an escape hatch.

---

### tuck bootstrap bundle

Edit `[bundles]` in `bootstrap.toml` from the CLI without hand-editing TOML.

**Synopsis**

    tuck bootstrap bundle list
    tuck bootstrap bundle show <name>
    tuck bootstrap bundle create <name> <tool...>
    tuck bootstrap bundle add <name> <tool>
    tuck bootstrap bundle rm <name> <tool>
    tuck bootstrap bundle delete <name> [-y]

**Examples**

    tuck bootstrap bundle list
    tuck bootstrap bundle show kali
    tuck bootstrap bundle create devbox ripgrep fzf neovim
    tuck bootstrap bundle add devbox pet
    tuck bootstrap bundle rm devbox pet
    tuck bootstrap bundle delete devbox

**Caveat**

Bundle edits re-serialize the entire `bootstrap.toml` via `smol-toml.stringify`, which reflows the document and strips hand-written comments. tuck warns on the first write if the prior file had comments. If your `bootstrap.toml` has load-bearing comments, back it up before running `bundle` edits, or stick to hand-editing.

**See also:** [Bootstrapping Tools](./Bootstrapping-Tools)

---

### tuck update

One-shot umbrella: `self-update` → `pull` → `restore` → `bootstrap update`.

**Synopsis**

    tuck update [options]

**Options**

- `--no-self` — skip the `tuck self-update` phase.
- `--no-pull` — skip the `git pull` phase on `~/.tuck/`.
- `--no-restore` — skip the `tuck restore --all` phase (which only runs when pull brought in new commits anyway).
- `--no-tools` — skip the `tuck bootstrap update --all` phase.
- `-y, --yes` — forward `--yes` to both self-update and bootstrap update.

**Examples**

    tuck update                 # full loop
    tuck update --no-self       # pull + restore + tools, skip self-update
    tuck update -y              # unattended

**Behavior notes**

- When the self-update phase applies a new version, `tuck update` re-execs the freshly-installed binary with `--no-self` so the remaining phases (pull / restore / tools) run under the new code, not the stale in-memory copy. The re-exec sets `TUCK_UPDATE_RESUMED=1` as a loop guard.
- `--install-deps` is passed implicitly to the restore phase so umbrella refreshes install missing tools as part of the one-shot sweep.

**Recipe:** see [Recipes — Run `tuck update` on a schedule](./Recipes#run-tuck-update-on-a-schedule) for a cron / systemd-timer setup.

---

## Secrets

### tuck secrets

Manage potentially-sensitive content in tracked files.

**Synopsis**

    tuck secrets scan
    tuck secrets set <key> <value>
    tuck secrets list

**Examples**

    tuck secrets scan                         # scan tracked files for API keys / tokens
    tuck secrets set API_KEY "your-actual-key"
    tuck secrets list

**See also:** [Security & Secrets](./Security-and-Secrets)
