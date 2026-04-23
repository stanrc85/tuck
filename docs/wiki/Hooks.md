# Hooks

Run custom commands before or after tuck's main operations. Useful for reloading shells, firing notifications, running follow-up installs, or gating syncs behind a test suite.

## Hook types

Four points in the lifecycle where tuck will run a command if configured:

| Hook          | When it runs                                                           |
| ------------- | ---------------------------------------------------------------------- |
| `preSync`     | Just before `tuck sync` starts its pull-detect-commit-push loop        |
| `postSync`    | After `tuck sync` finishes successfully (non-zero exit skips `postSync`) |
| `preRestore`  | Just before `tuck restore` / `tuck apply` starts writing files         |
| `postRestore` | After `tuck restore` / `tuck apply` finishes successfully              |

If a `pre*` hook exits non-zero, the main operation is **aborted** before any file changes happen. This lets you gate syncs/restores behind validation steps (run tests, check that a service is running, etc.).

If a `post*` hook exits non-zero, the main operation has already succeeded — the post-hook failure is logged but doesn't retroactively undo anything.

## Configuration

Hooks live in `config.hooks` — either in shared `.tuckrc.json` (applies everywhere) or per-host `.tuckrc.local.json` (overrides the shared hook of the same name).

**Shared `.tuckrc.json`:**

```json
{
  "hooks": {
    "preSync":     "echo 'about to sync'",
    "postSync":    "notify-send 'tuck: sync done'",
    "preRestore":  "",
    "postRestore": "source ~/.zshrc"
  }
}
```

**Per-host `.tuckrc.local.json`:**

```json
{
  "hooks": {
    "postRestore": "sed -i 's|snippet.toml|snippet-kali.toml|' ~/.config/pet/config.toml"
  }
}
```

**Merge semantics:** each hook type is independent. Setting `postRestore` in the local file replaces the shared `postRestore` but leaves `preSync`, `postSync`, and `preRestore` falling through to the shared file. This is how a kali-specific restore tweak lands without inlining a `[[ "$HOSTNAME" == "kali" ]] && …` guard in the shared file.

See [Configuration Reference — hooks](./Configuration-Reference#hooks).

## Execution environment

Hooks run as a single shell command string via:

- `sh -c '<hook>'` on macOS / Linux
- `pwsh -Command '<hook>'` on Windows (fallback: `powershell` if `pwsh` isn't installed)

**Working directory:** `~/.tuck/`. Useful when your hook is a git operation, a tuck subcommand, or something that wants to know where the repo lives.

**Environment variables passed through:**

| Variable         | Value                                                       |
| ---------------- | ----------------------------------------------------------- |
| `TUCK_HOOK`      | The hook name (`preSync`, `postSync`, `preRestore`, `postRestore`) |
| `TUCK_HOST`      | The current hostname                                        |
| `TUCK_GROUPS`    | Comma-separated list of the current host's `defaultGroups`  |
| `TUCK_DIR`       | Absolute path to `~/.tuck/`                                 |
| Existing env     | Your normal `$PATH`, `$HOME`, etc., are inherited           |

**Exit codes:**

- `0` — success, continue.
- Non-zero — pre-hooks abort the op; post-hooks log a warning and continue.
- If the hook times out (>10 min default), tuck kills it and treats as non-zero.

## Worked examples

### Reload zsh after restore

```json
{
  "hooks": {
    "postRestore": "exec zsh -l"
  }
}
```

`exec zsh -l` replaces the current shell with a fresh login shell — pulls in any `.zshrc` / `.zshenv` changes that just got restored. The current tuck process finishes first, so the shell replacement happens cleanly.

### Regenerate the cheatsheet on every sync

```json
{
  "hooks": {
    "postSync": "tuck cheatsheet --output ~/.tuck/cheatsheet.md"
  }
}
```

Keeps `<tuckDir>/cheatsheet.md` always in lockstep with the tracked dotfiles — the next `tuck sync` picks up the regenerated file.

### Run `nvim --headless Lazy sync` after plugin list changes

```json
{
  "hooks": {
    "postRestore": "if [ -f ~/.config/nvim/lazy-lock.json ]; then nvim --headless '+Lazy! sync' +qa; fi"
  }
}
```

Only runs when `lazy-lock.json` exists (so fresh hosts without nvim yet don't break). `+Lazy! sync` is non-interactive; `+qa` quits.

### Notify Slack on completed sync

```json
{
  "hooks": {
    "postSync": "curl -X POST -H 'Content-Type: application/json' -d '{\"text\":\"dotfiles synced on '\"$TUCK_HOST\"'\"}' https://hooks.slack.com/services/XXX/YYY/ZZZ"
  }
}
```

Fires a webhook with the hostname. If you do this, consider moving the webhook URL to a secret so it's not committed in `.tuckrc.json`.

### Gate sync on passing tests

```json
{
  "hooks": {
    "preSync": "cd ~/myproject && npm test --silent"
  }
}
```

Non-zero exit from `npm test` stops the sync before any commit. Your broken state stays uncommitted until you fix it.

### Host-specific vs shared hook

Shared `.tuckrc.json`:

```json
{
  "hooks": {
    "postRestore": "source ~/.zshrc"
  }
}
```

Per-host `.tuckrc.local.json` on kali:

```json
{
  "hooks": {
    "postRestore": "source ~/.zshrc && sed -i 's|snippet.toml|snippet-kali.toml|' ~/.config/pet/config.toml"
  }
}
```

The kali host runs its local hook; every other host runs the shared one. The local file fully replaces the shared hook of the same name — if you want to extend rather than replace, include the shared command in the local string (as above).

### Cross-platform via a script file

If your hook is more than a one-liner, put it in a script tracked by tuck and call the script:

```json
{
  "hooks": {
    "postRestore": "~/.tuck/hooks/post-restore.sh"
  }
}
```

The script lives in `~/.tuck/hooks/` (any path works; `~/.tuck/hooks/` is a sensible convention). Make it executable and version-controlled with the rest of your dotfiles.

For Windows + Unix interop, two hooks paths and a switch on `$TUCK_HOST` or `uname` inside a shared script is usually cleaner than fighting shell incompatibility.

## Testing hooks

Before wiring up a destructive hook, dry-run it by hand with the same env vars tuck passes:

```bash
TUCK_HOOK=postRestore \
TUCK_HOST=$(hostname) \
TUCK_DIR=$HOME/.tuck \
sh -c '<your hook command>'
```

If that prints what you expect and exits 0, tuck will too.

## See also

- [Configuration Reference — hooks](./Configuration-Reference#hooks)
- [Host Groups — Defaults](./Host-Groups#defaults--per-host-vs-shared-config) — for the shared-vs-local split
- [Cheatsheet — scheduled regeneration recipe](./Cheatsheet#scheduled-regeneration)
