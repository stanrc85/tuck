# Configuration Reference

Canonical schema for `.tuckrc.json` (shared) and `.tuckrc.local.json` (host-local). For the motivating story on why there are two files, see [Host Groups — Defaults](./Host-Groups#defaults--per-host-vs-shared-config).

> The per-field reference sections below are generated from
> [`src/schemas/config.schema.ts`](https://github.com/stanrc85/tuck/blob/main/src/schemas/config.schema.ts).
> Run `pnpm docs:gen` after editing the schema; CI fails if the page is out of sync.

## Where config lives

tuck loads config from three layers, in order:

1. Built-in defaults (see [`defaultConfig` in the source](https://github.com/stanrc85/tuck/blob/main/src/schemas/config.schema.ts))
2. `~/.tuck/.tuckrc.json` — shared, committed to the repo
3. `~/.tuck/.tuckrc.local.json` — host-local, gitignored

Each layer's values win over the layer before. The local file has a strict schema that only accepts a small set of host-specific fields — anything else is rejected, so you can't accidentally commit host state by writing to the wrong file.

## Editing

Two ways:

- **`tuck config`** — interactive menu (no arg) or dotted-path get/set (`tuck config set repository.autoPush true`). Automatically writes host-specific fields to `.tuckrc.local.json` and everything else to `.tuckrc.json`. Pass `--local` to force-route to `.tuckrc.local.json` for any local-schema-allowed key (e.g. `tuck config set --local hooks.preSync 'echo go'`); shared-only keys like `repository.autoCommit` are rejected with a clear error when `--local` is set. Refuses reserved key names (`__proto__`, `constructor`, `prototype`) at every dotted-path segment.
- **Hand-edit the JSON** — direct edit either file. Run `tuck doctor --category manifest` after to catch schema violations before they bite.

See [Command Reference — tuck config](./Command-Reference#tuck-config).

## Shared `.tuckrc.json` schema

All fields optional. Values shown are defaults.

### `repository`

<!-- TUCK_GEN:start config.repository -->
```json
{
  "repository": {
    "defaultBranch": "main",
    "autoCommit": true,
    "autoPush": false
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `defaultBranch` | `string` | `"main"` | Default git branch for the `~/.tuck/` repo |
| `autoCommit` | `boolean` | `true` | Whether `tuck sync` auto-commits detected changes |
| `autoPush` | `boolean` | `false` | Whether `tuck sync` auto-pushes after committing |
<!-- TUCK_GEN:end config.repository -->

### `files`

<!-- TUCK_GEN:start config.files -->
```json
{
  "files": {
    "strategy": "copy",
    "backupOnRestore": true
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `strategy` | `"copy"` \| `"symlink"` | `"copy"` | How tracked files are mirrored. See [File strategies](#file-strategies). |
| `backupOnRestore` | `boolean` | `true` | Snapshot tracked files before `tuck restore` / `tuck apply` overwrites them. Strongly recommended. |
<!-- TUCK_GEN:end config.files -->

See [File strategies](#file-strategies) for `copy` vs `symlink`.

### `defaultGroups`

<!-- TUCK_GEN:start config.defaultGroups -->
```json
{
  "defaultGroups": []
}
```

**Type**: `string[]`. **Default**: `[]`.

Host-groups applied to newly tracked files when `-g`/`--group` is not specified. Set by `tuck migrate` and editable via `tuck config`. Usually lives in `.tuckrc.local.json` (per-host).
<!-- TUCK_GEN:end config.defaultGroups -->

See [Host Groups](./Host-Groups#defaults--per-host-vs-shared-config) for the load-order + merge rules.

### `readOnlyGroups`

<!-- TUCK_GEN:start config.readOnlyGroups -->
```json
{
  "readOnlyGroups": []
}
```

**Type**: `string[]`. **Default**: `[]`.

Host-groups treated as read-only (consumer) roles. Any host whose `defaultGroups` intersects this list refuses write commands (`sync`, `push`, `add`, `remove`) with `HostReadOnlyError`. Override per invocation with `--force-write` or `TUCK_FORCE_WRITE=true`.
<!-- TUCK_GEN:end config.readOnlyGroups -->

See [Host Groups — Consumer-host mode](./Host-Groups#consumer-host-mode).

### `snapshots`

<!-- TUCK_GEN:start config.snapshots -->
```json
{
  "snapshots": {
    "maxCount": 50,
    "maxAgeDays": 30
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxCount` | `number` | `50` | Keep at most this many snapshots. `0` disables the count dimension. |
| `maxAgeDays` | `number` | `30` | Delete snapshots older than this. `0` disables the age dimension. |

Retention policy for Time Machine snapshots. Pruning runs after each new snapshot. Both `0` = no pruning.
<!-- TUCK_GEN:end config.snapshots -->

See [Time Machine & Undo](./Time-Machine-and-Undo).

### `hooks`

<!-- TUCK_GEN:start config.hooks -->
```json
{
  "hooks": {}
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `preSync` | `string` | — | Runs before `tuck sync` |
| `postSync` | `string` | — | Runs after `tuck sync` |
| `preRestore` | `string` | — | Runs before `tuck restore` |
| `postRestore` | `string` | — | Runs after `tuck restore` |

Shell commands run around sync/restore. Each runs in the `~/.tuck/` cwd. See [Hooks](./Hooks).
<!-- TUCK_GEN:end config.hooks -->

Each hook is sh/bash on Unix, pwsh on Windows, with a few env vars passed through. Full reference in [Hooks](./Hooks).

### `validation`

<!-- TUCK_GEN:start config.validation -->
```json
{
  "validation": {
    "preSync": false
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `preSync` | `boolean` | `false` | When `true`, run `tuck validate` against every tracked file at the start of `tuck sync` (warn-only — does not block). |

Validation policy. Opt-in only; default keeps `tuck sync` paying zero validation cost.
<!-- TUCK_GEN:end config.validation -->

When enabled, the sweep runs after secret-scanning and before any file writes — broken JSON / YAML / shell parses get surfaced before they land in your git history. Users who want hard-blocking can wire `tuck validate --format json` into a `hooks.preSync` hook instead (see [Hooks](./Hooks)). See also [tuck validate](./Command-Reference#tuck-validate).

### `ignore`

<!-- TUCK_GEN:start config.ignore -->
```json
{
  "ignore": []
}
```

**Type**: `string[]`. **Default**: `[]`.

Paths that `tuck scan` and `tuck add` skip automatically.
<!-- TUCK_GEN:end config.ignore -->

Prefer the `.tuckignore` file (use `tuck ignore add <path>`) for path-based ignores — this config field is for programmatic setups. See [Command Reference — tuck ignore](./Command-Reference#tuck-ignore).

### `categories`

<!-- TUCK_GEN:start config.categories -->
```json
{
  "categories": {}
}
```

**Type**: `Record<string, object>`. **Default**: `{}`.

Custom categories layered on top of the built-in set (`shell`, `git`, `editors`, `terminal`, `ssh`, `misc`).
<!-- TUCK_GEN:end config.categories -->

Map each category name → `{ patterns, icon? }`. `patterns` are globs matched against source paths during `tuck scan`.

### `ui`

<!-- TUCK_GEN:start config.ui -->
```json
{
  "ui": {
    "colors": true,
    "emoji": true,
    "verbose": false
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `colors` | `boolean` | `true` | ANSI colors in output |
| `emoji` | `boolean` | `true` | Unicode emoji / icons in prompts |
| `verbose` | `boolean` | `false` | Enable debug-level logging |

Terminal UX toggles. The `NO_COLOR=1` env var is also honored regardless of `colors`.
<!-- TUCK_GEN:end config.ui -->

### `remote`

<!-- TUCK_GEN:start config.remote -->
```json
{
  "remote": {
    "mode": "local"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `"github"` \| `"gitlab"` \| `"local"` \| `"custom"` | `"local"` | Provider |
| `url` | `string` | — | Custom git URL (for `custom` mode, or manual override) |
| `providerUrl` | `string` | — | Provider instance URL (e.g. self-hosted GitLab) |
| `username` | `string` | — | Cached username from the provider |
| `repoName` | `string` | — | Repo name without owner |

Provider configuration. See [Git Providers](./Git-Providers) for per-provider setup.
<!-- TUCK_GEN:end config.remote -->

### `security`

<!-- TUCK_GEN:start config.security -->
```json
{
  "security": {
    "scanSecrets": true,
    "blockOnSecrets": true,
    "minSeverity": "high",
    "scanner": "builtin",
    "customPatterns": [],
    "excludePatterns": [],
    "excludeFiles": [],
    "maxFileSize": 10485760,
    "secretBackend": "local",
    "cacheSecrets": true,
    "secretMappings": "secrets.mappings.json"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `scanSecrets` | `boolean` | `true` | Enable secret scanning |
| `blockOnSecrets` | `boolean` | `true` | Block operations when secrets are detected (vs. just warn) |
| `minSeverity` | `"critical"` \| `"high"` \| `"medium"` \| `"low"` | `"high"` | Minimum severity level to report |
| `scanner` | `"builtin"` \| `"gitleaks"` \| `"trufflehog"` | `"builtin"` | Scanner backend |
| `gitleaksPath` | `string` | — | Path to gitleaks binary (when `scanner` is `gitleaks`) |
| `trufflehogPath` | `string` | — | Path to trufflehog binary (when `scanner` is `trufflehog`) |
| `customPatterns` | `object[]` | `[]` | Additional secret patterns layered on top of the built-in set |
| `excludePatterns` | `string[]` | `[]` | Pattern IDs to exclude from scanning |
| `excludeFiles` | `string[]` | `[]` | Glob patterns for files to skip during scanning |
| `maxFileSize` | `number` | `10485760` | Maximum file size to scan, in bytes |
| `secretBackend` | `"local"` \| `"1password"` \| `"bitwarden"` \| `"pass"` \| `"auto"` | `"local"` | Backend used to resolve secret values at restore time |
| `backends` | `object` | — | Backend-specific configuration |
| `cacheSecrets` | `boolean` | `true` | Cache resolved secrets in memory during a session |
| `secretMappings` | `string` | `"secrets.mappings.json"` | Path to the secrets mappings file (relative to the tuck dir) |

Secret-scanning policy. Full reference in [Security & Secrets](./Security-and-Secrets).
<!-- TUCK_GEN:end config.security -->

### `encryption`

<!-- TUCK_GEN:start config.encryption -->
```json
{
  "encryption": {
    "enabled": false,
    "backupsEnabled": false,
    "files": []
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Master switch for encryption features |
| `backupsEnabled` | `boolean` | `false` | Enable encryption for backups |
| `gpgKey` | `string` | — | GPG key identifier (must be in your keyring) |
| `files` | `string[]` | `[]` | Tracked files to encrypt |

Optional GPG-based encryption for specific tracked files and/or backup snapshots. Defaults off.
<!-- TUCK_GEN:end config.encryption -->

If you enable encryption, set `gpgKey` to a key identifier that's in your GPG keyring — tuck won't generate a key for you.

## Local `.tuckrc.local.json` schema

Strict — only these fields allowed. Anything else is a schema error.

```json
{
  "defaultGroups": ["kali"],
  "hooks": {
    "postRestore": "sed -i 's|snippet.toml|snippet-kali.toml|' ~/.config/pet/config.toml"
  },
  "trustHooks": true
}
```

<!-- TUCK_GEN:start config.local -->
| Field | Type | Description |
|-------|------|-------------|
| `defaultGroups` | `string[]` | Per-host group tags auto-applied when `-g` is omitted |
| `hooks` | `object` | Per-host hook overrides. Each hook type merged independently with the shared hook of the same name. |
| `trustHooks` | `boolean` | When `true`, this host trusts every configured hook and skips the per-execution confirmation prompt. Local-only by design — see [Why `trustHooks` is local-only](#why-trusthooks-is-local-only). |
<!-- TUCK_GEN:end config.local -->

The strict schema exists to stop "I thought I was editing the local file but really wrote to the shared one" leaks. If you try to add `repository.autoPush` to `.tuckrc.local.json`, it's rejected with a clear error — because auto-push behavior is a repo-wide policy, not per-host.

Use `tuck config set --local <key> <value>` to write any local-schema-allowed key (e.g. `hooks.preSync`) without hand-editing the file. `--local` validates against the strict schema above, so the same shared-only keys that would be rejected on hand-edit are also rejected on the CLI.

To remove a key, use `tuck config unset --local <key>` — it goes through the same schema gate as `set --local`, drops the key, and prunes empty parent objects so the file doesn't accrete `{ hooks: {} }` shells over time. Unsetting a missing key is a no-op success (matches `git config --unset`).

To edit the file directly, `tuck config edit --local` opens `.tuckrc.local.json` in `$EDITOR` (creating an empty `{}` shell first if the file doesn't exist yet). `tuck config edit` without `--local` still opens the shared `.tuckrc.json` as before.

### Why `trustHooks` is local-only

Hooks run arbitrary shell commands on every sync/restore. The default per-execution prompt is the safety net: it forces you to look at the command before it runs, so a malicious commit landing in a shared hook can't silently execute on every clone.

If `trustHooks` lived in the shared `.tuckrc.json`, that same malicious commit could flip the bit on alongside the malicious hook command — defeating the prompt for every downstream host that pulls. Restricting `trustHooks` to `.tuckrc.local.json` (which is gitignored, never travels with the repo) means each host opts in deliberately for its own configured commands. The CLI enforces this: `tuck config set trustHooks true` (without `--local`) is rejected with an error pointing at the correct invocation; only `tuck config set --local trustHooks true` is accepted.

Set it only when:
- You wrote the hooks yourself, or you've audited every hook command in shared `.tuckrc.json`
- The host is yours alone (not a shared dev box)
- The dotfiles repo is yours / from a trusted source

To revoke: hand-edit `.tuckrc.local.json` and remove the `trustHooks` key (or wait for `tuck config unset --local trustHooks` once shipped).

## File strategies

### `copy` (default)

Files are **copied** from source → repo when tracked, and repo → source when restored. Changes require a `tuck sync` to propagate either direction.

This is the safe default:
- Edits to the source don't instantly land in git
- You can preview changes via `tuck diff` before committing
- Works on every platform without special permissions

### `symlink`

tuck copies the file into the repo once, then **replaces the source path with a symlink** pointing at the repo copy. Edits go straight to git.

Pros:
- No explicit sync needed for modifications — the repo is always current
- Single source of truth

Cons:
- Your home dotfile paths become symlinks; some tools (especially older editors, and a few shell features) don't love chasing them
- Breakage if `~/.tuck/` is ever moved or renamed
- On Windows, tuck uses **directory junctions** for folders and copies for files (symlink creation requires admin privileges on Windows — junctions don't)
- `tuck sync` is mostly a no-op for symlinked files; nothing to copy. Commits still capture repo-side git operations.

Switch per-file: `tuck add ~/.zshrc --symlink`. Switch the default in config.

## See also

- [Host Groups](./Host-Groups) — the motivation for the two-file setup
- [Command Reference — tuck config](./Command-Reference#tuck-config)
- [Hooks](./Hooks) — full hook reference with examples
- [Security & Secrets](./Security-and-Secrets) — the `security` block in detail
- [Source: `src/schemas/config.schema.ts`](https://github.com/stanrc85/tuck/blob/main/src/schemas/config.schema.ts) — the authoritative zod schema
