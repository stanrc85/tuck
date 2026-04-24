# Architecture

Contributor-facing reference: how tuck is laid out on disk, which module owns what, the exact shape of every on-disk format, and how a command flows from CLI entry to a git commit.

If you're here to learn tuck's **features** or **commands**, start with [Command Reference](./Command-Reference) or [Getting Started](./Getting-Started). Architecture lives here so that page-one contributors don't have to reverse-engineer it from 25 library modules.

For agent-specific conventions (CLAUDE Code + subagent routing) see [CLAUDE.md](https://github.com/stanrc85/tuck/blob/main/CLAUDE.md) and [AGENTS.md](https://github.com/stanrc85/tuck/blob/main/AGENTS.md) in the repo root — this page is language- and agent-neutral.

## Layout on disk

**Per-host working directory** (`~/.tuck/` by default, override via `-d/--dir`):

```
~/.tuck/
├── .tuckmanifest.json       # tracked files + group tags — committed to git
├── .tuckrc.json             # shared config — committed to git
├── .tuckrc.local.json       # per-host config — gitignored
├── .bootstrap-state.json    # per-host bootstrap install state — gitignored
├── .tuckignore              # patterns skipped by tuck scan / tuck add
├── .gitignore               # includes local files above
├── .git/                    # tuck repo (ordinary git working copy)
├── bootstrap.toml           # declarative tool catalog (optional)
└── files/
    ├── shell/.zshrc
    ├── editor/init.lua
    └── <category>/<path>
```

**Per-host backup directory** — intentionally **outside** `~/.tuck/` so snapshots survive a catastrophic `rm -rf ~/.tuck/`:

```
~/.tuck-backups/
└── <YYYY-MM-DD-HHMMSS>/
    ├── metadata.json        # SnapshotMetadata (see Data formats)
    └── <file-tree-copies>   # backed-up content
```

**Source tree:**

```
src/
├── commands/      # One file per top-level CLI verb (init, sync, add, …)
├── lib/           # Core library modules (25 files + 4 subdirs)
├── ui/            # Terminal UI primitives (prompts, logger, theme)
├── schemas/       # Zod schemas for config + manifest + bootstrap + secrets
├── errors.ts      # Custom error classes (NotInitializedError, GitError, …)
├── constants.ts   # App constants (DEFAULT_TUCK_DIR, LOCAL_CONFIG_FILE, …)
├── types.ts       # Shared TS types
└── index.ts       # Entry point — Commander setup + command registration
```

## Module map

`src/lib/` holds the non-CLI logic. Grouped by responsibility:

**Storage & tracking**
- `manifest.ts` — `.tuckmanifest.json` read/write, `getAllGroups`, file lookup by group.
- `config.ts` — `.tuckrc.json` + `.tuckrc.local.json` load/save; `loadLocalConfig` and `saveLocalConfig` for per-host-only keys.
- `files.ts` — file copy/symlink primitives, binary-safe reads, permission preservation.
- `fileTracking.ts`, `trackPipeline.ts` — high-level "track this file" orchestration (categorize → copy → add to manifest → stage).
- `paths.ts` — `expandPath()` / `collapsePath()`, `getTuckDir()`, `getConfigPath()`, `getManifestPath()`, `getBackupsDir()`. Every path goes through here — never assume `~` resolution.
- `tuckignore.ts` — `.tuckignore` parser and glob matcher.

**Git & providers**
- `git.ts` — `simple-git` wrapper: `cloneRepo`, `stageAll`, `commit`, `push`, `pull` (with `--rebase --autostash`), `getAheadBehind`.
- `providers/` — git-host abstraction (see [Provider abstraction](#provider-abstraction)).
- `providerSetup.ts` — interactive provider selection + auth wizard used by `tuck init`.
- `remoteChecks.ts` — pre-sync "is the remote reachable?" probes.
- `github.ts` — GitHub CLI (`gh`) integration beyond the generic provider interface (dotfiles-repo search, SSH-key UX, credential helpers).

**Scan & detection**
- `detect.ts` — heuristic dotfile discovery under `$HOME` with a category map (shell/editor/git/…).
- `binary.ts` — binary-file detection by content sniff.
- `syntaxHighlight.ts` — per-language tokenizer for `tuck diff`. Line-oriented, state-free (multi-line block comments are a known gap — see [TASK-052-FOLLOWUP](https://github.com/stanrc85/tuck/blob/main/.collab/kanban-board.md)).
- `osDetect.ts` — `/etc/os-release` → canonical group name (ubuntu / kali / arch / …) used by the init-time prompt.

**Safety**
- `timemachine.ts` — snapshot create/list/restore/prune. The load-bearing module behind every destructive operation — `tuck apply`, `tuck restore`, `tuck sync`, `tuck remove --delete`, `tuck clean`, `tuck validate --fix`, `tuck optimize --auto` all call `createSnapshot` before writing.
- `merge.ts` — smart-merge for shell config files (append-block markers, dedup, diff preview).
- `validation.ts` — input validation + error-to-message rendering.
- `groupFilter.ts` — manifest → per-group file filter.

**Diagnostics**
- `doctor.ts` — `tuck doctor` check groups (env / repo / manifest / security / hooks).
- `audit.ts` — internal audit log used by safety-gated commands.
- `validators/` — `tuck validate` dispatch (json, toml, shell, lua, fixers).
- `shellProfiler/` — `tuck optimize` xtrace parser + rule engine (parser, rules, runner).

**Other**
- `hooks.ts` — `preSync` / `postSync` / `preRestore` / `postRestore` execution with env-var shape.
- `platform.ts` — Windows-vs-POSIX forks (symlink permissions, path separators, junctions).
- `updater.ts` — `update-notifier` glue for the "new version available" banner.
- `bootstrap/` — `bootstrap.toml` parser, tool runner, dependency resolver, state persistence.

**Where to look when adding a new command:**
1. `src/commands/<name>.ts` — implement + Commander wire.
2. `src/commands/index.ts` + `src/index.ts` — register.
3. `tests/commands/<name>.test.ts` — safety-invariant tests.
4. `docs/wiki/Command-Reference.md` — entry under the right section.
5. Corresponding topic page in `docs/wiki/` if the command has a concept the reference alone doesn't cover.

## Data formats

### `.tuckmanifest.json` — tracked files

Canonical schema in [`src/schemas/manifest.schema.ts`](https://github.com/stanrc85/tuck/blob/main/src/schemas/manifest.schema.ts). Shape:

```jsonc
{
  "version": "2.0.0",
  "created": "2026-04-01T...",
  "updated": "2026-04-24T...",
  "machine": "kubuntu-desktop",
  "files": {
    "~/.zshrc": {
      "source": "~/.zshrc",
      "destination": "shell/zshrc",
      "category": "shell",
      "strategy": "copy",
      "encrypted": false,
      "added": "2026-04-01T...",
      "modified": "2026-04-24T...",
      "checksum": "sha256:…",
      "groups": ["kubuntu"]
    }
  }
}
```

- **`version: "2.0.0"`** — bumped to add host groups. Old 1.x manifests load with empty `groups` and trip `MigrationRequiredError`; `tuck migrate` backfills.
- **Post-migration invariant:** every file has at least one group. `tuck group rm` refuses to remove the last remaining group.
- **Keys in `files`** are the original `source` paths (`~/` intentionally preserved as a string — stored not expanded). `destination` is a repo-relative path under `~/.tuck/files/` using forward slashes (Windows-safe).

### `.tuckrc.json` vs `.tuckrc.local.json` — config split

Canonical schemas in [`src/schemas/config.schema.ts`](https://github.com/stanrc85/tuck/blob/main/src/schemas/config.schema.ts).

**`.tuckrc.json`** (shared, committed) holds fields that every host needs to agree on:

- `repository.*` (branch, autoCommit, autoPush)
- `files.*` (strategy, backupOnRestore, backupDir)
- `ignore`, `categories`, `readOnlyGroups`, `remote`, `security`, `snapshots`, `encryption`, `ui`
- `hooks` (fallback hooks; local can override per-type)

**`.tuckrc.local.json`** (per-host, gitignored) holds fields that vary by host:

- `defaultGroups` — which groups this host belongs to
- `hooks` — per-host overrides, merged over shared per-type

**Precedence:** `defaults → .tuckrc.json → .tuckrc.local.json`. `loadConfig()` returns the merged view. Callers that need to distinguish (e.g. the init-time prompt) use `loadLocalConfig()` to read only the local file.

Local-only keys route through `saveLocalConfig()` — writing them to shared would leak host-specific state across every clone (see the `defaultGroups` bug fixed in v2.22.2).

### `.bootstrap-state.json` — per-host tool installs

Canonical schema in [`src/lib/bootstrap/state.ts`](https://github.com/stanrc85/tuck/blob/main/src/lib/bootstrap/state.ts). Shape:

```jsonc
{
  "version": 1,
  "tools": {
    "ripgrep": {
      "installedAt": "2026-04-20T...",
      "version": "14.1.0",
      "definitionHash": "sha256:…"
    }
  }
}
```

- **Per-host, never committed.** Lives at `~/.tuck/.bootstrap-state.json`. Gitignore entry is auto-appended on first save.
- **`definitionHash`** is the SHA-256 of the normalized tool definition in `bootstrap.toml`. When the definition changes (version bump, install-command edit), the hash moves and `tuck bootstrap update` flags the tool as drift-detected.
- **`STATE_VERSION = 1`.** Missing file is indistinguishable from "nothing installed yet" — the common first-run state.
- **No concurrency:** `tuck bootstrap` processes tools sequentially, so load-then-save doesn't race. If that ever changes, revisit — a naive last-writer-wins would clobber entries.

### Snapshot format

Each destructive operation takes a snapshot in `~/.tuck-backups/<YYYY-MM-DD-HHMMSS>/` via `createSnapshot(paths, reason, { kind })` in [`src/lib/timemachine.ts`](https://github.com/stanrc85/tuck/blob/main/src/lib/timemachine.ts):

```
~/.tuck-backups/2026-04-24-163050/
├── metadata.json
└── <file-tree-copies>
```

**`metadata.json`** shape:

```jsonc
{
  "id": "2026-04-24-163050",
  "timestamp": "2026-04-24T16:30:50.123Z",
  "reason": "tuck restore -g kubuntu",
  "machine": "kubuntu-desktop",
  "profile": "kubuntu",
  "kind": "restore",
  "files": [
    { "originalPath": "/home/me/.zshrc", "backupPath": "home/me/.zshrc", "existed": true },
    { "originalPath": "/home/me/.tmux.conf", "backupPath": "home/me/.tmux.conf", "existed": false }
  ]
}
```

**`SnapshotKind`** (authoritative list in `timemachine.ts`):

| Kind            | Emitted by                                    |
|-----------------|-----------------------------------------------|
| `apply`         | `tuck apply`                                  |
| `restore`       | `tuck restore`                                |
| `sync`          | `tuck sync` (before writes)                   |
| `remove`        | `tuck remove --delete`                        |
| `clean`         | `tuck clean`                                  |
| `manual`        | `tuck snapshot create` (direct user ask)      |
| `validate-fix`  | `tuck validate --fix`                         |
| `optimize-auto` | `tuck optimize --auto`                        |

`tuck undo` surfaces snapshots grouped by kind so users can scan for the right roll-back point. Adding a new destructive command means adding a new `SnapshotKind` literal and a `formatSnapshotKind` case.

**Retention** — `pruneSnapshotsByRetention` runs after each new snapshot. Defaults from `.tuckrc.json`: `snapshots.maxCount: 50`, `snapshots.maxAgeDays: 30`. Either set to `0` disables that dimension.

## Provider abstraction

Git-host integration is behind the `GitProvider` interface in [`src/lib/providers/types.ts`](https://github.com/stanrc85/tuck/blob/main/src/lib/providers/types.ts). Four implementations today: `github`, `gitlab`, `custom` (Gitea / Bitbucket / SourceHut / self-hosted), `local` (no remote).

Interface surface (condensed):

```ts
interface GitProvider {
  readonly mode: 'github' | 'gitlab' | 'local' | 'custom';
  readonly displayName: string;
  readonly cliName: string | null;
  readonly requiresRemote: boolean;

  // Detection & auth
  isCliInstalled(): Promise<boolean>;
  isAuthenticated(): Promise<boolean>;
  getUser(): Promise<ProviderUser | null>;
  detect(): Promise<ProviderDetection>;

  // Repo ops
  repoExists(repoName: string): Promise<boolean>;
  createRepo(options: CreateRepoOptions): Promise<ProviderRepo>;
  getRepoInfo(repoName: string): Promise<ProviderRepo | null>;
  cloneRepo(repoName: string, targetDir: string): Promise<void>;
  findDotfilesRepo(username?: string): Promise<string | null>;

  // URL utilities
  getPreferredRepoUrl(repo: ProviderRepo): Promise<string>;
  validateUrl(url: string): boolean;
  buildRepoUrl(username: string, repoName: string, protocol: 'ssh' | 'https'): string;

  // Setup help
  getSetupInstructions(): string;
  getAltAuthInstructions(): string;
}
```

The **`RemoteConfig`** record in `.tuckrc.json` is what `loadConfig()` hands off to `getProvider(mode)`:

```jsonc
"remote": {
  "mode": "custom",
  "url": "https://gitea.stanley.cloud/me/dotfiles.git"
}
```

**Adding a new provider:**

1. Implement `GitProvider` in `src/lib/providers/<name>.ts`.
2. Register it in `src/lib/providers/index.ts`'s `getProvider()` switch.
3. Add a `ProviderMode` literal in `src/lib/providers/types.ts`.
4. Update [`Git Providers`](./Git-Providers) wiki page + [Command Reference](./Command-Reference#tuck-config) for the `remote.mode` value.

`local` provider is the "no remote" shape — every method no-ops or throws `LocalModeError`. Useful as a reference for providers that don't expose an API (e.g., a bare-git over SSH setup).

## Data flow walk-throughs

### `tuck sync`

1. `loadManifest()` + `loadConfig()`.
2. Filter manifest by `defaultGroups` (from local config) — files outside the host's groups are skipped.
3. Optional `preSync` hook via `hooks.ts`.
4. For each tracked file: read system version, compare to repo copy by checksum.
5. If changes → `createSnapshot(paths, 'tuck sync', { kind: 'sync' })` before any write.
6. Write-back to repo (`files.copy`), stage via `git.stageAll`, commit via `git.commit`.
7. Pull-rebase + push if `repository.autoPush` — `git.pull()` uses `--rebase --autostash` to survive incidental working-tree dirt.
8. Optional `postSync` hook.

### `tuck restore --bootstrap -g <group>`

1. `loadManifest()` + filter by `-g <group>`.
2. Optional `preRestore` hook.
3. `createSnapshot(paths, 'tuck restore', { kind: 'restore' })` covering every destination.
4. For each tracked file: materialize onto the system via `files.copy` or `files.symlink` based on `strategy`.
5. Optional `postRestore` hook.
6. If `--bootstrap` → chain into `runBootstrap()`: load `bootstrap.toml`, diff against `.bootstrap-state.json`, install deltas, save state.

### `tuck bootstrap`

1. Parse `bootstrap.toml` via `bootstrap/parser.ts` → validated `BootstrapConfig`.
2. Load `.bootstrap-state.json` via `bootstrap/state.ts` (empty on first run).
3. Resolve `bundle` / `-g` filters via `bootstrap/resolver.ts` → ordered list of tools.
4. For each tool: `detect()` runs the tool's detect command; if installed at the right version with matching `definitionHash`, skip.
5. Otherwise run install command via `bootstrap/runner.ts`, confirm via detect, update state.
6. `saveBootstrapState()` at the end — one write per bootstrap run.

## See also

- [Command Reference](./Command-Reference) — every command + flags + examples
- [Configuration Reference](./Configuration-Reference) — per-field walk of `.tuckrc.json` + `.tuckrc.local.json`
- [Time Machine & Undo](./Time-Machine-and-Undo) — snapshot-driven recovery recipes
- [Host Groups](./Host-Groups) — `defaultGroups` / `readOnlyGroups` semantics
- [Git Providers](./Git-Providers) — per-provider feature matrix
- [CLAUDE.md](https://github.com/stanrc85/tuck/blob/main/CLAUDE.md) + [AGENTS.md](https://github.com/stanrc85/tuck/blob/main/AGENTS.md) — agent-facing conventions
