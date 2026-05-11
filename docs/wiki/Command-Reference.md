# Command Reference

Every `tuck` command, with synopsis, flags, and worked examples. Use **Ctrl-F** to jump to a command. For the why-and-when, see the topic pages linked at the bottom of each entry.

> Synopsis and option lists below are generated from the commander definitions
> in [`src/commands/`](https://github.com/stanrc85/tuck/blob/main/src/commands).
> Run `pnpm docs:gen` after editing flags; CI fails if the page is out of sync.

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

<!-- TUCK_GEN:start cmd.init -->
**Synopsis**

    tuck init [options]

**Options**

- `-d, --dir <path>` — Directory for tuck repository
- `-r, --remote <url>` — Git remote URL to set up
- `--bare` — Initialize without any default files
- `--from <url>` — Clone from existing tuck repository
- `--no-detect-os` — Skip the `/etc/os-release` detection prompt (Linux only)
<!-- TUCK_GEN:end cmd.init -->

**Examples**

    # Fresh setup, interactive
    tuck init

    # Restore on a new machine by pointing at your dotfiles repo
    tuck init --from github.com/you/dotfiles
    tuck restore --all

    # Bare setup (no default files, configure remote later)
    tuck init --bare

**See also:** [Getting Started](./Getting-Started), [Git Providers](./Git-Providers)

---

### tuck sync

The one-command loop for pushing changes: pull (rebase+autostash) → detect changes in tracked sources → commit → push.

<!-- TUCK_GEN:start cmd.sync -->
**Synopsis**

    tuck sync [message] [options]

**Options**

- `-m, --message <msg>` — Commit message
- `--no-commit` — Stage changes but don't commit
- `--no-push` — Commit but don't push to remote
- `--no-pull` — Don't pull from remote first
- `--no-scan` — Don't scan for new dotfiles
- `--no-hooks` — Skip execution of pre/post sync hooks
- `--trust-hooks` — Trust and run hooks without confirmation (use with caution)
- `-g, --group <name>` — Filter by host-group (repeatable)
- `--list` — Preview which tracked files would be synced, then exit (no writes)
- `-f, --force` — Skip secret scanning (not recommended)
- `--force-write` — Override the readOnlyGroups consumer-host guardrail
<!-- TUCK_GEN:end cmd.sync -->

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

<!-- TUCK_GEN:start cmd.status -->
**Synopsis**

    tuck status [options]

**Options**

- `--short` — Short format
- `--json` — Output as JSON
<!-- TUCK_GEN:end cmd.status -->

**Examples**

    tuck status
    tuck status --short
    tuck status --json

**See also:** [tuck diff](#tuck-diff), [tuck sync](#tuck-sync)

---

## Managing files

### tuck add

Start tracking one or more files. Files are copied from their source path into `~/.tuck/files/<category>/` and an entry is added to the manifest.

<!-- TUCK_GEN:start cmd.add -->
**Synopsis**

    tuck add [paths...] [options]

**Options**

- `-c, --category <name>` — Category to organize under
- `-n, --name <name>` — Custom name for the file in manifest
- `-g, --group <name>` — Host-group to tag (repeatable: -g kubuntu -g work)
- `--symlink` — Copy into tuck repo, then replace source path with a symlink
- `-f, --force` — Skip secret scanning (not recommended)
- `--force-write` — Override the readOnlyGroups consumer-host guardrail
<!-- TUCK_GEN:end cmd.add -->

**Examples**

    tuck add ~/.zshrc ~/.gitconfig
    tuck add ~/.ssh/config -g work
    tuck add ~/.config/starship.toml -g work -g personal

**See also:** [tuck scan](#tuck-scan), [tuck group](#tuck-group)

---

### tuck remove

Stop tracking files. The source path on your host is **never** touched — only the repo copy and manifest entry are removed.

<!-- TUCK_GEN:start cmd.remove -->
**Synopsis**

    tuck remove [paths...] [options]

**Options**

- `--delete` — Also delete from tuck repository
- `--keep-original` — Don't restore symlinks to regular files
- `--push` — Untrack + delete from repo + commit + push (implies --delete)
- `-m, --message <msg>` — Override the auto-generated commit message (with --push)
- `--force-write` — Override the readOnlyGroups consumer-host guardrail
<!-- TUCK_GEN:end cmd.remove -->

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

<!-- TUCK_GEN:start cmd.scan -->
**Synopsis**

    tuck scan [options]

**Options**

- `-a, --all` — Show all files including already tracked ones
- `-c, --category <name>` — Filter by category (shell, git, editors, etc.)
- `-q, --quick` — Quick scan - just show detected files without interactive selection
- `--json` — Output results as JSON
<!-- TUCK_GEN:end cmd.scan -->

**Examples**

    tuck scan
    tuck scan --category editors

**See also:** [tuck add](#tuck-add), [tuck ignore](#tuck-ignore)

---

### tuck list

List tracked files, grouped by category with group tags per file.

<!-- TUCK_GEN:start cmd.list -->
**Synopsis**

    tuck list [options]

**Options**

- `-c, --category <name>` — Filter by category
- `-g, --group <name>` — Filter by host-group (repeatable)
- `--paths` — Show only paths
- `--json` — Output as JSON
<!-- TUCK_GEN:end cmd.list -->

**Examples**

    tuck list
    tuck list -g kali
    tuck list --paths | fzf    # fuzzy-pick a tracked file

**See also:** [tuck status](#tuck-status)

---

### tuck diff

Show differences between your system files and their repo copies. Useful before a sync to preview what would change.

<!-- TUCK_GEN:start cmd.diff -->
**Synopsis**

    tuck diff [paths...] [options]

**Options**

- `--staged` — Show staged git changes
- `--stat` — Show diffstat only
- `--category <category>` — Filter by file category (shell, git, editors, terminal, ssh, misc)
- `-g, --group <name>` — Filter by host-group (repeatable)
- `--name-only` — Show only changed file names
- `-s, --side-by-side` — Render diffs in two columns (auto-falls back on narrow terminals)
- `--exit-code` — Return exit code 1 if differences found
<!-- TUCK_GEN:end cmd.diff -->

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

<!-- TUCK_GEN:start cmd.ignore -->
**Synopsis**

    tuck ignore add <paths...>
    tuck ignore rm <paths...>
    tuck ignore list
<!-- TUCK_GEN:end cmd.ignore -->

**Examples**

    tuck ignore add ~/.cache ~/.local/share
    tuck ignore list
    tuck ignore rm ~/.cache

**See also:** [tuck scan](#tuck-scan)

---

### tuck group

Manage host-group tags on tracked files. Every tracked file belongs to at least one group.

<!-- TUCK_GEN:start cmd.group -->
**Synopsis**

    tuck group add <group> [paths...]
    tuck group rm <group> [paths...]
    tuck group list
    tuck group show <group>
<!-- TUCK_GEN:end cmd.group -->

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

<!-- TUCK_GEN:start cmd.migrate -->
**Synopsis**

    tuck migrate [options]

**Options**

- `-g, --group <name>` — Host-group to assign to untagged files (repeatable)
- `-y, --yes` — Skip prompts (use hostname as default group)
<!-- TUCK_GEN:end cmd.migrate -->

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

<!-- TUCK_GEN:start cmd.clean -->
**Synopsis**

    tuck clean [options]

**Options**

- `--dry-run` — Preview what would be removed without deleting
- `-y, --yes` — Skip the confirmation prompt
- `--commit` — Stage and commit the removal
- `--push` — Commit and push (implies --commit)
- `-m, --message <msg>` — Override the auto-generated commit message
<!-- TUCK_GEN:end cmd.clean -->

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

<!-- TUCK_GEN:start cmd.push -->
**Synopsis**

    tuck push [options]

**Options**

- `-f, --force` — Force push
- `--set-upstream <name>` — Set upstream branch
- `--force-write` — Override the readOnlyGroups consumer-host guardrail
<!-- TUCK_GEN:end cmd.push -->

---

### tuck pull

Pull + rebase + autostash from the remote into `~/.tuck/`. Called internally by `tuck sync`.

<!-- TUCK_GEN:start cmd.pull -->
**Synopsis**

    tuck pull [options]

**Options**

- `--rebase` — Pull with rebase
- `--restore` — Also restore files to system after pull
- `--mirror` — Reset to upstream (destroys local commits) — use on receiving-only hosts
- `--allow-divergent` — Bypass the divergence safety check (required with --mirror when ahead of upstream)
<!-- TUCK_GEN:end cmd.pull -->

---

## Restoring

### tuck apply

Apply another user's (or your own) dotfiles to the host. Smart-merges shell files to preserve local customizations.

<!-- TUCK_GEN:start cmd.apply -->
**Synopsis**

    tuck apply <source> [options]

**Options**

- `-m, --merge` — Merge with existing files (preserve local customizations)
- `-r, --replace` — Replace existing files completely
- `-g, --group <name>` — Filter files by host-group (repeatable)
- `--dry-run` — Show what would be applied without making changes
- `-f, --force` — Apply without confirmation prompts
- `-y, --yes` — Assume yes to all prompts
<!-- TUCK_GEN:end cmd.apply -->

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

<!-- TUCK_GEN:start cmd.restore -->
**Synopsis**

    tuck restore [paths...] [options]

**Options**

- `-a, --all` — Restore all tracked files
- `-g, --group <name>` — Filter by host-group (repeatable)
- `--symlink` — Create symlinks from source paths to tuck repo files
- `--backup` — Backup existing files before restore
- `--no-backup` — Skip backup of existing files
- `--dry-run` — Show what would be done
- `--no-hooks` — Skip execution of pre/post restore hooks
- `--trust-hooks` — Trust and run hooks without confirmation (use with caution)
- `--no-secrets` — Skip restoring secrets (keep placeholders as-is)
- `--install-deps` — Auto-install any missing tool dependencies detected from restored configs (non-interactive; also the opt-in for CI / non-TTY hosts)
- `--no-install-deps` — Skip the missing-deps prompt/advisory entirely
- `--install-missing` — Attempt `brew install` for tools referenced by restored dotfiles but not declared in bootstrap.toml. Per-tool brew failures warn and continue; manual-install tools (zimfw, neovim-plugins, zsh) are never auto-installed.
- `--bootstrap` — After restore, run `tuck bootstrap --bundle <g>` for each -g whose name matches a bundle (groups without a matching bundle soft-skip)
- `-y, --yes` — Skip confirmations (forwarded to bootstrap when --bootstrap is set)
- `-v, --verbose` — Stream nested bootstrap subprocess output to the terminal (full transcript always goes to ~/.tuck/logs/)
<!-- TUCK_GEN:end cmd.restore -->

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

<!-- TUCK_GEN:start cmd.undo -->
**Synopsis**

    tuck undo [snapshot-id] [options]

**Options**

- `-l, --list` — List all available backup snapshots
- `--latest` — Restore the most recent snapshot
- `--file <path>` — Restore a single file from the snapshot
- `--delete <id>` — Delete a specific snapshot
- `-f, --force` — Skip confirmation prompts
- `--dry-run` — Show what would be restored without making changes
<!-- TUCK_GEN:end cmd.undo -->

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

<!-- TUCK_GEN:start cmd.cheatsheet -->
**Synopsis**

    tuck cheatsheet [options]

**Options**

- `-o, --output <path>` — Write the cheatsheet to this path (default: <tuckDir>/cheatsheet.<ext>)
- `--stdout` — Print to stdout instead of writing a file
- `--sources <ids>` — Comma-separated parser ids to include (default: every registered parser)
- `-g, --group <name>` — Filter tracked files by host-group (repeatable)
- `--format <md|json>` — Output format: md (GitHub-flavored markdown) or json (flat entries for jq/fzf)
- `--no-timestamp` — Omit the wall-clock generated timestamp (avoids noisy diffs when the cheatsheet is auto-regenerated)
<!-- TUCK_GEN:end cmd.cheatsheet -->

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

    # Auto-regen on every sync without noisy commits
    tuck config set --local hooks.preSync 'tuck cheatsheet --no-timestamp'

**See also:** [Cheatsheet](./Cheatsheet) — consumer recipes (zsh+fzf picker, jq queries, etc).

---

## Configuration

### tuck config

View and edit configuration. Without arguments, drops into an interactive menu.

<!-- TUCK_GEN:start cmd.config -->
**Synopsis**

    tuck config get <key>
    tuck config set <key> <value>
    tuck config unset <key>
    tuck config list
    tuck config edit
    tuck config reset
    tuck config remote
<!-- TUCK_GEN:end cmd.config -->

**Examples**

    tuck config                              # interactive menu
    tuck config get repository.autoPush
    tuck config set repository.autoPush true
    tuck config set defaultGroups '["kali"]'
    tuck config set --local hooks.preSync 'tuck cheatsheet'
    tuck config set --local trustHooks true  # this host trusts every hook
    tuck config unset --local hooks.preSync  # remove a per-host hook
    tuck config edit --local                 # open .tuckrc.local.json in $EDITOR
    tuck config remote                       # configure provider

**Behavior notes**

- `tuck config set` writes to the **shared** `.tuckrc.json` by default. Fields that must be per-host (`defaultGroups`, per-host `hooks`) write to `.tuckrc.local.json` automatically — no flag needed.
- `--local` on `set`/`unset`/`edit` routes the operation to `.tuckrc.local.json` for any local-schema-allowed key. Shared-only keys (e.g. `repository.autoCommit`) are rejected with a clear error when `--local` is set.
- `trustHooks` is local-only by design and **must** be set with `--local` — see [Configuration Reference → trustHooks](./Configuration-Reference#why-trusthooks-is-local-only) for the security rationale.
- `unset` is a no-op success (not an error) when the key isn't present — same as `git config --unset`. Empty parent objects are pruned automatically.
- Keys are dotted paths: `repository.autoPush`, `snapshots.maxCount`, `remote.mode`.
- `tuck config` refuses reserved key names (`__proto__`, `constructor`, `prototype`) at every dotted-path segment.

**See also:** [Configuration Reference](./Configuration-Reference), [Git Providers](./Git-Providers)

---

## Diagnostics

### tuck doctor

Run repository-health and safety diagnostics. Useful after upgrades or when something feels off.

<!-- TUCK_GEN:start cmd.doctor -->
**Synopsis**

    tuck doctor [options]

**Options**

- `--json` — Output as JSON
- `--strict` — Exit non-zero on warnings
- `-c, --category <category>` — Run only one category (env|repo|manifest|security|hooks)
<!-- TUCK_GEN:end cmd.doctor -->

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

Syntax-check tracked files — JSON, TOML, YAML, shell (bash/zsh), Lua. Report-only by default; `--fix` previews + applies a narrow set of safe rewrites after confirmation.

<!-- TUCK_GEN:start cmd.validate -->
**Synopsis**

    tuck validate [paths...] [options]

**Options**

- `--format <type>` — Output format: text | json
- `--fix` — Preview + apply fixes (trailing whitespace, EOF newline, JSON pretty-print)
- `-y, --yes` — Skip the confirmation prompt (still previews, still snapshots)
<!-- TUCK_GEN:end cmd.validate -->

**Examples**

    tuck validate                         # validate every tracked file
    tuck validate ~/.zshrc ~/.tmux.conf   # validate a subset
    tuck validate --format json           # for CI — exit 1 on any failure
    tuck validate --fix                   # preview + confirm fixes
    tuck validate --fix -y                # non-interactive apply (CI)

**Validators**

- **JSON** — `JSON.parse` + line:col extraction from the error message.
- **TOML** — `smol-toml.parse`; surfaces `line` / `column` from `TomlError` when available.
- **YAML** — `yaml.parse` (eemeli/yaml); surfaces `line` / `column` from `YAMLError.linePos` when available.
- **Shell** — `bash -n` / `zsh -n` dispatched by filename. `.zsh`, `.zshrc`, `.zshenv`, `.zprofile`, `.zlogin`, `.zlogout` → zsh; everything else → bash. Warn-skips when the shell binary isn't installed. When `shellcheck` is also on `$PATH`, bash files additionally run through `shellcheck --format=gcc` and lint findings (SC2086 quoting, SC2034 unused vars, etc.) merge in as `warning`-severity issues. zsh files skip shellcheck — it doesn't understand zsh syntax and would false-positive on common idioms.
- **Lua** — `luac -p`. Warn-skips when `luac` isn't on `$PATH`.

**Behavior notes**

- Exit code 1 if any file fails validation (so `tuck validate --format json` drops into CI as-is).
- `--fix` handles three rewrite shapes: trailing whitespace, missing EOF newline, and (for `.json` files) canonical 2-space pretty-print via `JSON.stringify(JSON.parse(raw), null, 2)`. The pretty-print fires only when the file parses cleanly — broken JSON falls through to the line-level fixer so the parse error stays visible in the regular validate output.
- Before any write, `--fix` creates a Time Machine snapshot (`SnapshotKind: validate-fix`) so `tuck undo` can roll it back.
- Non-TTY invocation without `--yes` refuses to write — preview only. Guard against "CI silently fixed my files" surprise.
- Set `validation.preSync: true` in `.tuckrc.json` to auto-run validation before every `tuck sync` and surface failures inline (warn-only — does not block the sync). See [Configuration Reference](./Configuration-Reference#validation).

**See also:** [tuck doctor](#tuck-doctor), [tuck undo](#tuck-undo), [Time Machine & Undo](./Time-Machine-and-Undo)

---

### tuck optimize

Profile shell startup and flag rule-based recommendations. Supports zsh and bash. Report-only by default; `--auto` previews + applies the safe subset of fixes after confirmation.

<!-- TUCK_GEN:start cmd.optimize -->
**Synopsis**

    tuck optimize [options]

**Options**

- `--profile` — Profile only — skip the recommendation engine
- `--auto` — Preview + apply the safe subset of auto-fixes (with confirmation)
- `-y, --yes` — Skip the confirmation prompt (still previews, still snapshots)
- `--format <type>` — Output format: text | json
- `--shell <name>` — Shell to profile: zsh | bash (default: detect from $SHELL)
<!-- TUCK_GEN:end cmd.optimize -->

**Examples**

    tuck optimize                         # profile + recommendations (auto-detect shell)
    tuck optimize --profile               # timing attribution only
    tuck optimize --shell bash            # profile bash even if $SHELL is zsh
    tuck optimize --auto                  # preview + confirm auto-fixes
    tuck optimize --format json           # for scripting

**Profiler**

- Runs `<shell> -ixc exit` with a shell-specific PS4: zsh uses `+%D{%s.%6.}|%N|%i> ` (epoch seconds + microseconds + source + line); bash 5+ uses `+${EPOCHREALTIME}|${BASH_SOURCE}|${LINENO}> `. Both emit the same `+<timestamp>|<source>|<line>> <command>` event shape so the parser stays shell-agnostic.
- Source files read for rule evidence: zsh — `.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`. bash — `.bashrc`, `.bash_profile`, `.profile`, `.bash_login`.
- Attributes each line's wall-clock delta to the previous event's source file.
- Output is a descending list of hot source files with aggregate time.

**Rules**

- **multiple-compinit** — `compinit` called more than once during startup. Zsh-specific (compinit is a zsh feature; never fires under bash). Recommends `skip_global_compinit=1` in `~/.zshenv`. Suppressed when that line is already present in any startup file.
- **duplicate-path** — the same directory appears more than once across the shell's startup files. Reads source files directly, not xtrace events (so repeated PATH entries inside functions don't false-positive).
- **sync-version-managers** — synchronous load of nvm / rbenv / pyenv at startup. Recommends a lazy-load pattern and embeds a paste-ready shim in the evidence — first invocation pays the init cost, every later shell stays fast. Internal events from inside the manager's scripts don't count toward the trigger.
- **blocking-startup** — network / auth calls at shell start (`curl`, `wget`, `ssh`, `gpg`, `git pull`, `gh auth`, `op signin`). Uses first-token + multi-word phrase matching so mentions in comments or strings don't false-positive.
- **guarded-source** (info) — flags `if [[ -f X ]]; then source X; fi` blocks (single-line and multi-line forms). Suggests collapsing to `[[ -f X ]] && source X`, or dropping the existence check entirely if the file is part of your dotfiles repo and always present. Cosmetic; severity is `info`.

**Behavior notes**

- `--auto` applies PATH dedup **only** as a suggestion today, not a rewrite — rewriting PATH across variable expansions, conditionals, and substitutions is easy to get wrong. Manual edit suggested in the report.
- Before any write, `--auto` creates a Time Machine snapshot (`SnapshotKind: optimize-auto`) so `tuck undo` can roll it back.
- Non-TTY invocation without `--yes` refuses to write.

**See also:** [tuck validate](#tuck-validate), [tuck undo](#tuck-undo), [Time Machine & Undo](./Time-Machine-and-Undo)

---

## Maintenance

### tuck self-update

Update tuck itself to the latest GitHub release of `stanrc85/tuck`.

<!-- TUCK_GEN:start cmd.self-update -->
**Synopsis**

    tuck self-update [options]

**Options**

- `--check` — Report update status without installing (exit 1 if an update is available)
- `-y, --yes` — Apply the update without prompting
- `--tag <tag>` — Install a specific release tag (e.g. v1.2.0)
<!-- TUCK_GEN:end cmd.self-update -->

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

<!-- TUCK_GEN:start cmd.bootstrap -->
**Synopsis**

    tuck bootstrap [options]

**Options**

- `-f, --file <path>` — Path to bootstrap.toml (default: <tuckDir>/bootstrap.toml)
- `--all` — Install every tool in the catalog (skip picker)
- `--bundle <name>` — Install a named bundle (skip picker)
- `--tools <ids>` — Comma-separated tool ids to install (skip picker)
- `--rerun <ids>` — Comma-separated tool ids to force-reinstall (bypass check)
- `--dry-run` — Print the planned tools without executing
- `-y, --yes` — Skip confirmations and enable sudo pre-check under --yes
- `--no-detect` — In the picker, ignore detection signals and show a flat list
- `--skip-preflight` — Skip clock/disk/network/sudo preflight probes (CI escape hatch)
- `-v, --verbose` — Stream every install/update line to the terminal (full transcript always goes to ~/.tuck/logs/)
<!-- TUCK_GEN:end cmd.bootstrap -->

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

<!-- TUCK_GEN:start cmd.bootstrap.update -->
**Synopsis**

    tuck bootstrap update [options]

**Options**

- `-f, --file <path>` — Path to bootstrap.toml (default: <tuckDir>/bootstrap.toml)
- `--all` — Update every installed tool (skip picker)
- `--tools <ids>` — Comma-separated tool ids to update (skip picker)
- `--check` — Report pending updates without running them (exit 1 if any)
- `--dry-run` — Print the plan without executing
- `-y, --yes` — Skip confirmations and enable sudo pre-check under --yes
- `--skip-preflight` — Skip clock/disk/network/sudo preflight probes (CI escape hatch)
- `-v, --verbose` — Stream every update line to the terminal (full transcript always goes to ~/.tuck/logs/)
<!-- TUCK_GEN:end cmd.bootstrap.update -->

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

<!-- TUCK_GEN:start cmd.bootstrap.bundle -->
**Synopsis**

    tuck bootstrap bundle list
    tuck bootstrap bundle show <name>
    tuck bootstrap bundle create <name> <tools...>
    tuck bootstrap bundle add <name> <tool>
    tuck bootstrap bundle rm <name> <tool>
    tuck bootstrap bundle delete <name>
<!-- TUCK_GEN:end cmd.bootstrap.bundle -->

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

<!-- TUCK_GEN:start cmd.update -->
**Synopsis**

    tuck update [options]

**Options**

- `--no-self` — Skip the self-update phase
- `--no-pull` — Skip the dotfiles-repo pull phase
- `--no-restore` — Skip the dotfile restore phase
- `--no-tools` — Skip the bootstrap update phase
- `-y, --yes` — Skip confirmations in each phase
- `--mirror` — Reset to upstream (destroys local commits) instead of rebasing
- `--allow-divergent` — Bypass the divergence safety check (required with --mirror when ahead of upstream)
- `-v, --verbose` — Stream every restore/update subprocess line to the terminal (full transcripts always go to ~/.tuck/logs/)
<!-- TUCK_GEN:end cmd.update -->

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

<!-- TUCK_GEN:start cmd.secrets -->
**Synopsis**

    tuck secrets list
    tuck secrets set <name>
    tuck secrets unset <name>
    tuck secrets path
    tuck secrets scan [paths...]
    tuck secrets scan-history
    tuck secrets backend
    tuck secrets map <name>
    tuck secrets mappings
    tuck secrets test
<!-- TUCK_GEN:end cmd.secrets -->

**Examples**

    tuck secrets scan                         # scan tracked files for API keys / tokens
    tuck secrets set API_KEY "your-actual-key"
    tuck secrets list

**See also:** [Security & Secrets](./Security-and-Secrets)
