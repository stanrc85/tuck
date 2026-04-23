# Time Machine & Undo

tuck takes an automatic snapshot of any files it's about to overwrite or delete, so you can always roll back. This is the safety net that makes destructive commands cheap to try.

## What snapshots are

Snapshots live in `~/.tuck-backups/` — **outside** the synced `~/.tuck/` repo so they stay per-host and never leak across machines. Each snapshot is a directory containing the affected files + a manifest recording what operation created them.

Every destructive command creates a snapshot before making changes:

| Kind      | Created before                                                           |
| --------- | ------------------------------------------------------------------------ |
| `apply`   | `tuck apply` overwrites host files                                       |
| `restore` | `tuck restore` overwrites host files                                     |
| `sync`    | `tuck sync` overwrites the repo-side copies of modified tracked files    |
| `remove`  | `tuck remove --delete` / `--push` deletes a repo-side copy               |
| `clean`   | `tuck clean` removes orphaned files from the repo                        |
| `manual`  | Ad-hoc snapshot (e.g. via the programmatic API)                          |

Snapshot IDs are timestamps: `2026-04-18-143022` is a snapshot taken 2026-04-18 at 14:30:22 local time.

## `tuck undo` workflows

```bash
# List every snapshot (kind + date + file count)
tuck undo --list

# Interactive pick-one
tuck undo

# Restore the latest
tuck undo --latest

# Restore a specific snapshot by ID
tuck undo 2026-04-18-143022

# Restore only one file from a snapshot
tuck undo 2026-04-18-143022 --file ~/.zshrc

# Delete a snapshot (no recovery after this — it's gone)
tuck undo --delete 2026-04-18-143022
```

See [Command Reference — tuck undo](./Command-Reference#tuck-undo) for the full flag list.

**Restore semantics:** `tuck undo <id>` writes every file in the snapshot back to its original path. If the current file at that path differs, the current version is itself snapshotted (kind: `manual`) before being overwritten — so an `undo` is itself undoable.

## Retention

Snapshots are pruned automatically after each new one is created. Defaults:

- Keep the 50 newest snapshots
- Drop anything older than 30 days

Tune in `.tuckrc.json`:

```json
{
  "snapshots": {
    "maxCount": 50,
    "maxAgeDays": 30
  }
}
```

Set either value to `0` to disable that dimension. Both `0` = never prune (disk use grows unbounded — don't do this unless you have a retention policy elsewhere).

## Recovery recipes

### "I accidentally applied the wrong user's dotfiles"

```bash
# List snapshots — find the apply you want to reverse
tuck undo --list

# Should look like:
#   2026-04-23-101545  apply    12 files
#   2026-04-23-101440  manual   3 files
#   2026-04-22-184511  sync     5 files

# Restore the pre-apply state
tuck undo 2026-04-23-101545
```

### "My `.zshrc` is broken after `tuck restore`"

```bash
# The restore took a snapshot of the old .zshrc before overwriting
tuck undo --latest --file ~/.zshrc
```

Restores just `~/.zshrc` from the most recent snapshot, leaves every other restored file in place. Faster than a full rollback when you know which file broke.

### "I meant to use `tuck sync --list` to preview, but ran `tuck sync`"

```bash
# sync snapshots are kind:sync, one per sync
tuck undo --list | grep sync | head -5

# Pick the one you want to reverse, then restore
tuck undo 2026-04-23-093012
```

Note: `tuck sync` also commits to `~/.tuck/`. Undoing the file changes on the host doesn't roll back the git commit in the tuck repo — if you already pushed, you'd also need `git -C ~/.tuck reset --hard HEAD~1` (before anything else pushed on top) to fully undo. For this reason, if you're worried about accidental syncs, prefer [`tuck sync --list`](./Command-Reference#tuck-sync) for a preview pass first.

### "Disk is filling up — tuck-backups are huge"

```bash
# See sizes
du -sh ~/.tuck-backups/*/ | sort -rh | head -20

# Drop the retention limits
tuck config set snapshots.maxCount 20
tuck config set snapshots.maxAgeDays 7

# Force a prune right now by creating any no-op snapshot
tuck sync --list   # no-op if nothing's changed
```

tuck only prunes *after* creating a new snapshot, so tightening the limits doesn't instantly shrink disk use — the next op that would create a snapshot will clean up.

## See also

- [Command Reference — tuck undo](./Command-Reference#tuck-undo)
- [Configuration Reference — snapshots](./Configuration-Reference#snapshots)
- [tuck clean](./Command-Reference#tuck-clean) — companion command for removing orphaned files
