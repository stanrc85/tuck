# Git Providers

tuck supports multiple git hosting providers, detected automatically during `tuck init`. The provider decides how tuck creates the remote (or whether it does at all) and whether push/pull need any provider-specific CLI wrapping.

## Provider matrix

| Provider | `mode`      | CLI required | Auto-create remote? | Notes                                              |
| -------- | ----------- | ------------ | ------------------- | -------------------------------------------------- |
| GitHub   | `"github"`  | `gh`         | Yes                 | Full integration; release-binary self-update       |
| GitLab   | `"gitlab"`  | `glab`       | Yes                 | gitlab.com + self-hosted                           |
| Local    | `"local"`   | None         | N/A (no remote)     | Local git only — no sync across machines           |
| Custom   | `"custom"`  | None         | No (you set URL)    | Any git URL — Gitea, Bitbucket, Codeberg, SourceHut, private forges |

The current provider is stored in `config.remote.mode`. See [Configuration Reference — remote](./Configuration-Reference#remote) for the full schema.

## Switching providers

```bash
# Interactive — prompts for provider, credentials, repo name
tuck config remote

# Or via the top-level config menu
tuck config
# → Select "Configure remote"
```

Switching from `github` → `custom` (for example) doesn't migrate the data — it just changes the git remote URL. Your `~/.tuck/` working copy stays put; git handles the switch via `git remote set-url`.

## GitHub

**Requires:** `gh` CLI installed and authenticated (`gh auth login`).

**What tuck does:**

1. Reads your username from `gh api user`.
2. Creates `<user>/dotfiles` (or whatever you pass to `--from` / the setup prompt). Repo is private by default; tuck asks before flipping it public.
3. Sets the remote URL (HTTPS or SSH based on your existing `gh` auth mode).
4. Does the initial push.

**Things that need GitHub specifically:**

- `tuck self-update` pulls release tarballs from `github.com/stanrc85/tuck/releases` regardless of your dotfiles provider — self-update is about updating tuck, not your dotfiles.
- `tuck apply <user>` currently only resolves against GitHub. To apply from GitLab / elsewhere, use `tuck init --from <full-url>` on a fresh host instead.

## GitLab

**Requires:** `glab` CLI installed and authenticated (`glab auth login`).

### gitlab.com

Works out of the box — `tuck init` → pick GitLab → enter your gitlab.com username. Same auto-create flow as GitHub.

### Self-hosted GitLab

```bash
tuck init
# → Select GitLab
# → Select "Self-hosted"
# → Enter your GitLab host (e.g., gitlab.company.com)
```

tuck writes `remote.providerUrl` to your config and calls `glab` with `--host <providerUrl>` for every provider API call.

**Hostname detection** is exact-or-subdomain: `gitlab.com` accepts `gitlab.com` and `*.gitlab.com`, and `gitlab.company.com` accepts exactly that host. Substring lookalikes (`evil-gitlab.com`, `gitlab.com.attacker.net`) are rejected. For self-hosted gitlab under arbitrary hostnames without "gitlab" in the label, tuck falls back to treating the remote as `custom` — you'll push+pull without provider-specific API integration, which works fine for a plain git host.

## Local-only

**No remote at all.** Useful for:

- Airgapped hosts or kiosks
- Experimenting with tuck before committing to a remote
- Dotfiles you genuinely don't want off-host (physically-isolated research machines, etc.)

```bash
tuck init
# → Select "Local only"
```

`tuck sync` works fine; it just skips the push step. `tuck pull` is a no-op. If you later decide you want a remote, `tuck config remote` can switch to any of the other providers without losing git history — the local `~/.tuck/` repo gets a new `origin` pointed at wherever you set it.

## Custom

**Any git URL.** Paste what `git clone` would take:

```
git@codeberg.org:you/dotfiles.git
ssh://git@gitea.home.lan:2222/you/dotfiles.git
https://someforge.internal/you/dotfiles
```

tuck's custom mode is provider-agnostic — no auto-create, no API calls. You're responsible for creating the repo on the remote side before `tuck init` can push to it. Everything else (sync, push, pull, apply-from-url) works identically.

**Known-good hosts in custom mode:**

- **Gitea** — self-hosted; works on Synology, in Docker, baremetal. If it accepts a `git push`, tuck's happy.
- **Bitbucket** — both cloud and server.
- **Codeberg** — gitea-based public host.
- **SourceHut** — works; note that the push URL format is `git@git.sr.ht:~you/dotfiles`.
- **Internal corporate forges** — anything that speaks git over SSH or HTTPS.

**Things you give up in custom mode:**

- Auto-create: you create the repo yourself on the forge.
- `tuck apply <user>` — only GitHub today. Use `tuck init --from <full-url>` + `tuck restore --all` on a fresh host instead.
- Provider-specific CLI integration (no `gh`/`glab` calls).

## Migrating between providers

Switching `github` → `gitlab` (or any combination) is cheap:

```bash
# 1. Create the new destination repo (on the new provider's UI or via its CLI)

# 2. Switch tuck's remote pointer
tuck config remote
# → pick new provider, enter username + repo name

# 3. Push the existing history to the new remote
cd ~/.tuck
git push -u origin main

# 4. Update other hosts that clone this repo to the new URL
# On each host:
cd ~/.tuck
git remote set-url origin <new-url>
```

`tuck` on the other hosts doesn't need config changes unless their `remote.mode` reads the new provider — for push/pull, the git remote URL is what matters.

## See also

- [Command Reference — tuck config](./Command-Reference#tuck-config)
- [Configuration Reference — remote](./Configuration-Reference#remote)
- [Getting Started](./Getting-Started) — first-time setup with each provider
