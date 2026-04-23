# Security & Secrets

Dotfiles are a known surface for leaked credentials — AWS keys left in `.envrc`, API tokens in shell history, cloud-provider credentials in profile scripts. tuck bakes a few defaults and one opt-in workflow to keep that out of your committed repo.

## What tuck blocks by default

`tuck add` refuses to track these paths regardless of intent:

- **SSH private keys** — `*.pem`, `id_rsa`, `id_ed25519`, `id_ecdsa`, any path under `~/.ssh/` that isn't `config` or a `.pub` file.
- **`.env` files** — bare `.env`, `.env.local`, `.env.production`, etc.
- **Known credential files** — `.npmrc` (when containing a token), `.pypirc`, AWS credentials, Google Cloud SDK state.

This is a hard block at the command level, not a config option. If you genuinely need to track a file matching one of these patterns (rare — usually you want a non-sensitive copy instead), you'd edit the source detection code. Opening a PR with the use case is probably the right move.

## Secret scanning

When `tuck add`, `tuck sync`, or `tuck doctor --category security` reads tracked content, it runs each file through a pattern scanner looking for common credential shapes:

- AWS access key IDs + secret keys
- GitHub / GitLab / Bitbucket personal access tokens
- Slack tokens
- Google API keys
- Stripe keys (sk_live / pk_live)
- JWT tokens
- Generic "looks-like-a-token" patterns (base64 blobs with high entropy on "secret"-named variables)

A match prints a warning with file + line + pattern id. Under the default `blockOnSecrets: true`, operations that would commit secret-matching content **abort** — you have to either `tuck secrets set <placeholder> <value>` (see below) or add the pattern/file to the exclusion list.

### Severity levels

Patterns are tagged `critical` / `high` / `medium` / `low`. The `minSeverity` config knob controls the threshold for reporting:

```json
{
  "security": {
    "minSeverity": "high",    // default
    "blockOnSecrets": true    // default
  }
}
```

Set `"minSeverity": "medium"` to see lower-confidence matches too. Set `"blockOnSecrets": false` to log-and-continue instead of aborting (not recommended — turns the scanner into advisory noise).

### External scanners

If you prefer `gitleaks` or `trufflehog` over the built-in scanner:

```json
{
  "security": {
    "scanner": "gitleaks",        // or "trufflehog"
    "gitleaksPath": "/usr/local/bin/gitleaks"
  }
}
```

tuck invokes the external tool with a structured-output flag and merges findings into its own report. Neither tool is a runtime dependency — tuck only calls them if configured.

### Exclusions

Three ways to exclude, from narrowest to broadest:

```json
{
  "security": {
    "excludePatterns": ["aws-secret-key"],       // by pattern id
    "excludeFiles": ["secrets.example.json"],    // by file glob
    "maxFileSize": 10485760                      // bytes (default 10MB — files larger aren't scanned)
  }
}
```

And custom patterns if you have a private credential shape to detect:

```json
{
  "security": {
    "customPatterns": [
      {
        "name": "my-internal-token",
        "pattern": "INT_[A-Z0-9]{32}",
        "severity": "critical",
        "description": "Internal service tokens",
        "placeholder": "INT_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        "flags": "g"
      }
    ]
  }
}
```

## Placeholder pattern

When a file SHOULD be tracked but contains secrets inline (e.g. a shell profile that exports `OPENAI_API_KEY=...`), use placeholders instead:

1. **In the tracked file**, replace the secret with a `{{PLACEHOLDER}}` token:

    ```zsh
    export OPENAI_API_KEY="{{OPENAI_API_KEY}}"
    export AWS_ACCESS_KEY_ID="{{AWS_ACCESS_KEY}}"
    ```

2. **Store the actual value** locally via `tuck secrets set`:

    ```bash
    tuck secrets set OPENAI_API_KEY "sk-abc123..."
    tuck secrets set AWS_ACCESS_KEY "AKIA..."
    ```

3. **On restore**, tuck resolves the placeholders from the local store (never from the repo) before writing to the source path.

The actual values live in `~/.tuck/secrets.local.json`, which is automatically added to `.gitignore` and **never committed**. The repo holds only the placeholder-bearing text.

**List / inspect / set:**

```bash
tuck secrets set API_KEY "real-value"
tuck secrets list                           # names + placeholders, NOT values
tuck secrets get API_KEY                    # value (prompts for confirmation)
tuck secrets rm API_KEY
tuck secrets scan                           # scan tracked files for new secrets
```

See [Command Reference — tuck secrets](./Command-Reference#tuck-secrets).

## External secret managers

Instead of tuck's local store, resolve placeholders from a real password manager. Configure the backend:

```json
{
  "security": {
    "secretBackend": "1password",
    "backends": {
      "1password": {
        "vault": "Development",
        "serviceAccount": false,
        "cacheTimeout": 300
      }
    }
  }
}
```

**Supported backends:**

- `local` — default. `secrets.local.json` in `~/.tuck/`.
- `1password` — resolves via `op read "op://<vault>/<item>/<field>"`. Requires `op` CLI + active session (or `OP_SERVICE_ACCOUNT_TOKEN` for CI).
- `bitwarden` — resolves via `bw get password <item>`. Requires `bw` CLI + unlocked vault.
- `pass` — resolves via `pass show <name>`. Requires `pass` + GPG key.
- `auto` — probes for available backends in order: 1password → bitwarden → pass → local.

With `secretBackend: "1password"` set and a mapping like:

```json
// ~/.tuck/secrets.mappings.json
{
  "OPENAI_API_KEY": "op://Development/OpenAI/credential",
  "AWS_ACCESS_KEY": "op://Development/AWS/access-key"
}
```

tuck resolves `{{OPENAI_API_KEY}}` in any tracked file by calling `op read "op://Development/OpenAI/credential"` at restore time.

**Caching:** resolved values are held in memory for `cacheTimeout` seconds (default 300), so restoring 50 files that all reference the same secret doesn't trigger 50 separate `op read` calls.

## Dotfile content vs backup snapshots

**Secret scanning covers tracked dotfile content.** Backup snapshots in `~/.tuck-backups/` are NOT scanned — they hold whatever was on disk at the moment of the pre-operation snapshot, which can include unredacted secrets the user never intended to share.

Snapshots are per-host, never synced, and live outside `~/.tuck/` specifically so they can't leak upstream. Don't push `~/.tuck-backups/` anywhere.

If you need encryption on backups (e.g., a shared dev host where other users could read your home dir), the `encryption` config block exists:

```json
{
  "encryption": {
    "enabled": true,
    "backupsEnabled": true,
    "gpgKey": "0xABCDEF12"
  }
}
```

GPG key must already be in your keyring; tuck won't generate one.

## Commands

```bash
tuck secrets scan                    # scan tracked files for pattern matches
tuck secrets set NAME "value"        # store a secret locally
tuck secrets get NAME                # retrieve (confirmation prompt)
tuck secrets list                    # list names (no values)
tuck secrets rm NAME                 # delete
```

See [Command Reference — tuck secrets](./Command-Reference#tuck-secrets) for the full flag list.

## See also

- [Command Reference — tuck secrets](./Command-Reference#tuck-secrets)
- [Configuration Reference — security](./Configuration-Reference#security)
- [Configuration Reference — encryption](./Configuration-Reference#encryption)
- [Source: `src/lib/secrets/`](https://github.com/stanrc85/tuck/blob/main/src/lib/secrets/) — scanner, patterns, backends
