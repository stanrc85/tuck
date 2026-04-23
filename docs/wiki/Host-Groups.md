# Host Groups

One tuck repo; several very different machines. **Host groups** tag each tracked file with one or more labels (e.g. `work`, `kubuntu`, `kali`, `personal`) so commands that apply files can scope to the current host.

## Why host groups?

Without groups, tuck would either track the union of every file across every machine (and try to restore all of them everywhere) or force you to keep separate repos per host. Both are painful. Host groups let you keep **one** dotfiles repo and still say "on kali, only restore these files" or "never push this file from the kubuntu host."

Every tracked file belongs to at least one group. Group-aware commands (`tuck sync`, `tuck restore`, `tuck apply`, `tuck list`, `tuck diff`) accept `-g <name>` (repeatable) to filter.

## Typical workflow

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

See the [Command Reference entries for `tuck group`](./Command-Reference#tuck-group) and `-g` flags for the complete syntax.

## Defaults — per-host vs shared config

The magic trick is that `config.defaultGroups` can live in a **host-local** config file that's gitignored, while everything else in your `.tuckrc.json` stays shared. This way every host can have its own `defaultGroups` without polluting the shared repo.

**Load order:**

1. Built-in defaults
2. `~/.tuck/.tuckrc.json` — shared, committed to the repo
3. `~/.tuck/.tuckrc.local.json` — host-local, gitignored

The local file wins per-field. The shared file stays clean across all hosts.

**Example — `~/.tuck/.tuckrc.local.json` on the kali host:**

```json
{
  "defaultGroups": ["kali"],
  "hooks": {
    "postRestore": "sed -i 's|snippet.toml|snippet-kali.toml|' ~/.config/pet/config.toml"
  }
}
```

**Allowed fields in `.tuckrc.local.json`** (strict schema — anything else is rejected):

- `defaultGroups` — per-host groups auto-applied when `-g` is omitted on every group-aware command.
- `hooks` — per-host hook overrides (`preSync`, `postSync`, `preRestore`, `postRestore`). Each hook type is merged independently: a `postRestore` set in the local file replaces the shared `postRestore` but leaves the other three hooks falling through to `.tuckrc.json`.

If you omit `-g` on any group-aware command, tuck uses `defaultGroups` as the scope. On a kali host where `defaultGroups = ["kali"]`, a bare `tuck sync` / `tuck restore` / `tuck apply` / `tuck list` / `tuck diff` all scope to kali-tagged files automatically. Pass `-g <name>` to override, or pass an explicit path to `tuck diff <path>` / `tuck restore <path>` to bypass the scope for that one file.

For `tuck sync` specifically, `defaultGroups` also fixes a data-loss corner case: files tagged for other hosts are **not** flagged as deleted just because their source doesn't exist on this machine.

## Consumer-host mode

Sometimes you want a host to be a **pure consumer** of dotfiles — it should pull and restore, but never be the origin of a sync. For example: kubuntu is your workstation (producer); kali is a VM that tracks the same repo but shouldn't ever push back because you don't want its drift (different `.zshrc` history file, different paths) to leak upstream.

Set `readOnlyGroups` in the **shared** `.tuckrc.json`:

```json
{
  "readOnlyGroups": ["kali", "work-mac-loaner"]
}
```

Then on any host whose `defaultGroups` intersects `readOnlyGroups`, every write-side command (`tuck sync`, `tuck push`, `tuck add`, `tuck remove`) refuses with `HostReadOnlyError` and suggests `tuck update` instead.

**Escape hatches:**

- `--force-write` on any write-side command — one-shot bypass.
- `TUCK_FORCE_WRITE=true` env var — bypass for the whole session (useful when deliberately bootstrapping a new consumer host).

**What happens on unassigned hosts?** When `readOnlyGroups` is configured, tuck also gates hosts that haven't declared `defaultGroups` at all — those are treated as "role undeclared" and blocked until you set one:

```bash
tuck config set defaultGroups '["kali"]'
```

The error class is `HostRoleUnassignedError` (not `HostReadOnlyError`), so the remediation suggestion points at config, not `--force-write`.

**Why this exists:** real-world flavor — one repo, producer (kubuntu) + consumer (kali), consumer started originating syncs during a rebase and collided with producer's `lazy-lock.json`. `readOnlyGroups` made the consumer permanently read-only from the dotfiles-sync perspective while still letting it pull updates via `tuck update`.

## Migrating from 1.x

If you upgraded from a pre-2.0 manifest (no groups), every command errors with `MigrationRequiredError` until you run:

```bash
# Interactive — prompts for the group name (defaults to hostname)
tuck migrate

# Or non-interactive
tuck migrate -g laptop

# Multiple groups
tuck migrate -g laptop -g work
```

`tuck migrate` is idempotent; running it on an already-migrated manifest is a no-op.

**If you had `defaultGroups` committed inside the shared `.tuckrc.json`** (the pre-local-config shape), the one-time migration is:

```bash
# On each host — write this host's group to the local (gitignored) file
echo '{"defaultGroups": ["kali"]}' > ~/.tuck/.tuckrc.local.json

# Add the local filename to the repo's .gitignore (keeps it untracked)
grep -qxF '.tuckrc.local.json' ~/.tuck/.gitignore \
  || echo '.tuckrc.local.json' >> ~/.tuck/.gitignore

# Edit ~/.tuck/.tuckrc.json — delete the defaultGroups line (leave
# everything else in place), then commit + push once from any host
# so every host picks it up on next sync.
```

## Previewing scope before a sync

Unsure what a sync would touch? Run `tuck sync --list` first. It prints the scope, every tracked file that would be modified or untracked, and its group tags — no writes, no commit, no push.

```
$ tuck sync --list
tuck sync — preview

ℹ Scoped to host-group: kali

3 files would be synced:
  ~ ~/.zshrc [kali]
  ~ ~/.gitconfig [kali, shared]
  - ~/.oldrc [kali] (source missing — would untrack)
```

This is the safe way to diagnose a misconfigured scope: if you see a file tagged `[shared]` that shouldn't be on this host, fix the tags with `tuck group rm <group> <path>` before syncing.

## See also

- [Command Reference — tuck group](./Command-Reference#tuck-group)
- [Command Reference — tuck migrate](./Command-Reference#tuck-migrate)
- [Configuration Reference](./Configuration-Reference) — full schema for `.tuckrc.json` and `.tuckrc.local.json`
- [Recipes — Set up a consumer host](./Recipes#set-up-a-consumer-host)
