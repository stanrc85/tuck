# Bootstrapping Tools

`tuck bootstrap` installs CLI tools on a fresh machine from a declarative catalog. Think of it as the orchestration half of "new-machine setup" — dotfiles come from [`tuck apply`](./Command-Reference#tuck-apply) / [`tuck restore`](./Command-Reference#tuck-restore); the CLIs those dotfiles expect come from `tuck bootstrap`.

## Quick start

```bash
# Interactive picker — detected tools pre-checked
tuck bootstrap

# Plan without running anything
tuck bootstrap --all --dry-run

# Install specific tools
tuck bootstrap --tools neovim,pet

# Install a named bundle
tuck bootstrap --bundle kali
```

See the full flag list in [Command Reference — tuck bootstrap](./Command-Reference#tuck-bootstrap).

## `bootstrap.toml` is the source of truth

`bootstrap.toml` is **required** — there is no built-in tool registry in v3+. If the file doesn't exist (or is empty), `tuck bootstrap` exits cleanly with "nothing to do". Define every tool you want bootstrapped as a `[[tool]]` block.

> **Migrating from v2.x?** v2 shipped a 12-tool built-in registry (fzf, eza, bat, fd, ripgrep, neovim, neovim-plugins, pet, yazi, tealdeer, zsh, zimfw). v3 removed it — copy the [full template](#starter-templates) and trim to taste, or use the [restore-time uncovered-references warning](#restore-time-uncovered-references-warning) to surface the gaps interactively.

### Starter templates

Two annotated templates ship with tuck:

```bash
# Minimal starter — field reference + a couple of canned examples
cp "$(npm root -g)/@prnv/tuck/templates/bootstrap.toml.example" ~/.tuck/bootstrap.toml

# Full Debian/Ubuntu/Kali dev-workstation setup — bulk apt tier, Node
# toolchain, neovim-plugins, ZimFW, zsh-fzf-history-search, plus
# ready-to-use `kali`, `full`, and `minimal` bundles
cp "$(npm root -g)/@prnv/tuck/templates/bootstrap.toml.full.example" ~/.tuck/bootstrap.toml
```

### Minimal `[[tool]]` shape

```toml
[[tool]]
id = "ripgrep"
description = "recursive grep"
category = "shell"
requires = []                              # other tool ids this one needs first
check = "command -v rg >/dev/null 2>&1"    # exit 0 = already installed, skip
install = "sudo apt-get install -y ripgrep"
update = "sudo apt-get install -y --only-upgrade ripgrep"
detect = { paths = [], rcReferences = ["rg"] }   # picker detection hints
```

### Extended example with variable interpolation

```toml
[[tool]]
id = "my-custom-tool"
description = "something local"
version = "2.1.0"                           # interpolated as ${VERSION}
install = """
curl -fsSL https://example.com/tool-v${VERSION}-${OS}-${ARCH}.tar.gz | tar -xz -C /tmp
mv /tmp/tool /usr/local/bin/
"""
update = "@install"                         # @install or omitted → re-run install
updateVia = "self"                          # or "system" to defer to OS package manager

[bundles]
kali      = ["ripgrep", "fzf", "pet", "neovim", "neovim-plugins"]
minimal   = ["ripgrep", "fzf"]
```

### Tool fields

| Field               | Type                      | Purpose                                                                 |
| ------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `id`                | string (required)         | Unique id; used by `--tools`, `requires`, bundle lists                  |
| `description`       | string                    | Shown in the picker                                                     |
| `category`          | string                    | Grouping label in the picker                                            |
| `version`           | string                    | Interpolated as `${VERSION}` in install/update/check                    |
| `requires`          | string[]                  | Other tool ids that must be installed first (transitive)                |
| `check`             | string (shell)            | Exit 0 = already installed, skip install. Exit non-zero = proceed.      |
| `install`           | string (shell)            | Install command. Required unless `installer` is set. Runs in `sh` (or `pwsh` on Windows). |
| `update`            | string (shell) or `@install` | Update command. `@install` or omitted → re-run `install`. Disallowed when `installer` is set (auto-generated). |
| `updateVia`         | `"self"` \| `"system"` \| `"manual"`    | `"system"` defers to OS package manager, `"manual"` defers to manual user invocation (see [below](#updatevia-system)). Default `"self"`. |
| `installer`         | `"brew"` \| `"apt"`       | Opt-in shorthand: tuck synthesizes `install`/`check`/`update` from `packages` (see [below](#installer--packages-shorthand)). Mutually exclusive with raw `install`/`check`/`update`. |
| `packages`          | array of strings or `{name, bin?}` tables | Package list consumed by `installer`. Strings are sugar for `{name: <s>}`. Use the object form for brew when the binary differs from the formula (`{name = "neovim", bin = "nvim"}`). |
| `postInstall`       | string (shell)            | Appended after the synthesized `install` script. Use for symlinks, cache rebuilds, one-shot DB updates. Only valid with `installer`. |
| `postUpdate`        | string (shell)            | Appended after the synthesized `update` script. Only valid with `installer`. |
| `detect.paths`      | string[]                  | Glob paths that, if present, mark the tool as "detected" in the picker  |
| `detect.rcReferences` | string[]                 | Substrings to look for in tracked shell dotfiles (rc/alias/function refs) |
| `associatedConfig`  | string[]                  | Globs of config paths this tool owns. Used by `tuck restore` to offer a post-restore install prompt when those paths get written but the tool isn't installed. |

### `installer` + `packages` shorthand

When a single `[[tool]]` block manages a long list of brew formulas or apt packages, hand-editing the `install`/`check`/`update` strings in lockstep gets old fast. Set `installer = "brew"` (or `"apt"`) and list the packages once — tuck synthesizes the three scripts at parse time.

```toml
[[tool]]
id = "brew-cli-utils"
description = "CLIs managed by Homebrew"
requires = ["homebrew"]
installer = "brew"
packages = [
  "fzf", "yazi", "bat", "fd", "fastfetch", "jq", "lnav", "eza", "pet", "glow",
  { name = "neovim",   bin = "nvim" },     # formula name ≠ binary name
  { name = "ripgrep",  bin = "rg" },
  { name = "tealdeer", bin = "tldr" },
]
postInstall = """
sudo ln -sf /home/linuxbrew/.linuxbrew/bin/nvim /usr/local/bin/nvim
/home/linuxbrew/.linuxbrew/bin/tldr --update || true
"""
postUpdate = """
/home/linuxbrew/.linuxbrew/bin/tldr --update || true
"""
```

This expands to (roughly):

- `check` — a `for bin in <bins>; do test -x "/home/linuxbrew/.linuxbrew/bin/$bin" || exit 1; done` loop.
- `install` — `set -e; "$BREW" install <names>; <postInstall>`.
- `update` — `set -e; "$BREW" update; "$BREW" upgrade <names> || true; <postUpdate>` (the `|| true` is baked in so one bad formula doesn't fail the whole batch).

For apt:

```toml
[[tool]]
id = "dev-utilities"
description = "CLI utility packages (apt-managed)"
requires = ["system-prereqs"]
installer = "apt"
packages = ["dtrx", "ffmpeg", "7zip", "poppler-utils", "imagemagick", "build-essential"]
updateVia = "system"
```

apt expands to:

- `check` — `for pkg in <names>; do dpkg -s "$pkg" >/dev/null 2>&1 || exit 1; done` (stricter than `command -v` — works for non-binary packages like `build-essential`).
- `install` — `set -e; sudo apt-get install -y <names>; <postInstall>`.
- `update` — `sudo apt-get install -y --only-upgrade <names>; <postUpdate>`.

**Rules:**

- `installer` is mutually exclusive with raw `install`/`check`/`update`. Pick one mode per block.
- `packages` is required and must be non-empty when `installer` is set.
- `bin` is brew-only — apt checks via package name, not binary.
- Brew paths are hardcoded to `/home/linuxbrew/.linuxbrew/bin` (Linuxbrew). Drop down to a raw `install` block if you need macOS or Apple-Silicon brew prefixes.
- Need something the synthesizer doesn't generate (e.g., conditional formula install, complex pre-checks)? Don't use `installer` — write the raw `install`/`check`/`update` scripts yourself. The two modes coexist; only the block you opt into uses synthesis.

### Bundles

`[bundles]` is a table where each key is a bundle name and the value is an array of tool ids:

```toml
[bundles]
kali    = ["ripgrep", "fzf", "pet", "neovim", "neovim-plugins"]
minimal = ["ripgrep", "fzf"]
devbox  = ["neovim", "neovim-plugins", "tealdeer", "pet"]
```

Install a bundle with `tuck bootstrap --bundle kali`. Edit bundles without hand-editing TOML via [`tuck bootstrap bundle`](./Command-Reference#tuck-bootstrap-bundle) — watch the comment-stripping caveat if your file has load-bearing comments.

### `[registry] disabled` (deprecated)

Pre-v3 this field opted specific built-ins out of the registry overlay. v3 removed the registry, so the field is a no-op — it still parses cleanly so existing `bootstrap.toml` files keep working, but the value is ignored at merge time. Drop the section when you next edit the file.

## Restore-time uncovered-references warning

When `tuck restore` lays down dotfiles, it scans the restored shell rc files and config paths for references to a static well-known set of common shell tools — the legacy v2 registry plus modern ecosystem essentials (`zoxide`, `starship`, `atuin`, `mise`, `direnv`, `gh`, `lazygit`, `bottom`, `helix`, `tmux`, `zellij`, `pyenv`). The full canonical list lives at [`src/lib/bootstrap/wellKnownTools.ts`](https://github.com/stanrc85/tuck/blob/main/src/lib/bootstrap/wellKnownTools.ts) — open a PR there to add more entries. If your dotfiles reference one of those tools and your `bootstrap.toml` has no `[[tool]]` block providing it, restore prints a warning:

```
⚠ Detected 2 tools referenced by restored dotfiles with no covering bootstrap.toml entry:
  • fzf — command-line fuzzy finder
  • zimfw — modular zsh framework (needs manual entry)

ℹ Add `[[tool]]` blocks to bootstrap.toml to track these, or re-run with --install-missing
   to attempt `brew install`.
```

Coverage is liberal — `tuck` considers a well-known tool covered if any of your `[[tool]]` blocks: matches the id, mentions the binary or brew formula in its install/update commands, or lists the well-known id in `detect.rcReferences`. The user pattern of bundling several CLIs into one `brew install fzf yazi neovim …` block (see the `brew-cli-utils` example in the templates) counts as covering each one.

### `--install-missing` — opt-in brew install

For brew-installable tools, `tuck restore --install-missing` will attempt `brew install <formula>` for each uncovered reference. Per-tool brew failures (formula not found, network error, brew not on PATH) warn and continue rather than aborting the restore. Manual-install tools (`zimfw`, `neovim-plugins`, `zsh` as a system shell) appear in the warning but are never auto-installed — they need real `[[tool]]` blocks.

```bash
tuck restore --install-missing
```

This does **not** modify `bootstrap.toml` — anything you install this way only persists on the current host. Add a `[[tool]]` block to track the tool across all your machines.

### Suppressing the warning per id — `[restore] ignoreUncovered`

When a tool is referenced in your dotfiles but you intentionally don't want tuck to flag or auto-install it (e.g., starship installed via a one-off; zimfw skipped on Kali), list its id under `[restore]`:

```toml
[restore]
ignoreUncovered = ["starship", "zimfw"]
```

The setting persists with your dotfiles repo, so the suppression list syncs across hosts. Unknown ids (typos, ids removed from the well-known table later) are no-ops, not errors.

## Variable interpolation

Exactly five tokens are substituted in `check`, `install`, and `update` strings:

| Token          | Value                                                             |
| -------------- | ----------------------------------------------------------------- |
| `${VERSION}`   | The tool's `version` field. Throws if referenced and unset.       |
| `${ARCH}`      | `amd64` / `arm64` / `armhf` (Debian-style, mapped from `os.arch()`) |
| `${OS}`        | `linux` / `darwin` / `windows`                                    |
| `${HOME}`      | User home directory                                               |
| `${TUCK_DIR}`  | Absolute path to the tuck data directory                          |

Anything else — `${PATH}`, `$(uname -m)`, `$HOME` — passes through untouched so the shell expands it at run time. tuck deliberately does **not** reach through arbitrary env vars; expand them in the script itself if you need to.

## Dependencies and order

`requires` targets are resolved transitively. Pick `neovim-plugins` and `neovim` is pulled in automatically, installed first, and tagged `(dep)` in the output. Cycles and unknown ids fail fast with the participating tool names in the error.

Example output:

```
Resolving install order…
  neovim (dep)
  neovim-plugins
  pet
  ripgrep

Installing…
  ✓ neovim (detected v0.10.2, updating to v0.10.3)
  ✓ neovim-plugins (Lazy! sync: 142 plugins synced)
  ✓ pet (v0.4.2 installed via dpkg -i)
  ✓ ripgrep (already installed, skipped)

4 installed, 0 failed, 0 skipped
```

## State and drift detection

Successful installs are recorded in `~/.tuck/.bootstrap-state.json` (per-host; never synced) with a SHA-256 hash of the normalized tool definition. If the definition changes (in your `bootstrap.toml`), the picker surfaces the tool as **"outdated."**

Re-run with `--rerun <id>` to force a reinstall ignoring the `check` probe:

```bash
tuck bootstrap --rerun neovim
```

**State file schema** (don't edit by hand — it's a machine file):

```json
{
  "neovim": {
    "installedAt": "2026-04-22T14:30:22Z",
    "version": "0.10.3",
    "definitionHash": "sha256:abc123…"
  }
}
```

## `updateVia: "system"` / `"manual"`

Some tools shouldn't routinely re-run on `tuck bootstrap update`. Two reasons:

- **`"system"`** — the host package manager (apt, brew, dnf, nix) already updates the tool. Re-running tuck's `update` is redundant at best and racy at worst (two package operations fighting for the apt lock).
- **`"manual"`** — no package manager is involved, but the user wants the tool refreshed only when they explicitly say so. Curl-from-GitHub-release fonts, one-shot cache rebuilds, and similar "set it and forget it" tools fit here.

Both share the same skip behavior; only the deferred-log message differs:

```toml
[[tool]]
id = "ripgrep"
install = "sudo apt-get install -y ripgrep"
update = "sudo apt-get install -y --only-upgrade ripgrep"
updateVia = "system"                        # defer to apt

[[tool]]
id = "nerd-font-roboto-mono"
install = "..."
update = "@install"
updateVia = "manual"                        # only refresh when I say so
```

**Behavior (both `"system"` and `"manual"`):**

- `tuck bootstrap --all` and the picker still INSTALL the tool (install is the "first-time setup" path).
- `tuck bootstrap update --all` and the picker **skip** the tool. The deferred-log message branches by reason:
  - `"system"` → `Deferred to system package manager: <ids>`
  - `"manual"` → `Manually managed: <ids> (run \`tuck bootstrap update --tools <id>\` to refresh)`
- `tuck bootstrap update --check` excludes the tool from both the `pending` payload AND the exit-code signal — CI running `tuck bootstrap update --check` won't fail just because apt has a newer `ripgrep` available, or because a font's GitHub release has moved.
- `tuck bootstrap update --tools <id>` is the escape hatch — explicit naming always runs the update script regardless of `updateVia`.

Use `"system"` when something else (brew, apt, nix, etc.) owns updates. Use `"manual"` when nothing else owns updates but you want to call the shots on timing.

## Sudo handling

Every `sudo <cmd>` line prompts interactively as usual. Under `--yes`, tuck pre-checks `sudo -n true` whenever the script contains `sudo` — if credentials aren't cached, you get one clear error ("run `sudo -v` first, or configure NOPASSWD") instead of a mystery hang deep inside a multi-line install command.

## Failure containment

A single tool's install failing **does not abort the run.** Dependents of a failed tool are marked `skipped-dep-failed` and the loop continues. The final summary reports `N installed, M failed, K skipped` with per-tool detail, and tuck exits non-zero if anything failed so CI pipelines catch it.

Example:

```
Installing…
  ✓ ripgrep
  ✗ custom-tool (exit 42: curl: (6) could not resolve host example.com)
  ⊘ custom-tool-wrapper (skipped-dep-failed: custom-tool)
  ✓ fzf

2 installed, 1 failed, 1 skipped

Failed tools:
  custom-tool — network error, re-run when connectivity is restored
```

## `tuck update` — the umbrella

`tuck update` chains `self-update` → `pull` → `restore` → `bootstrap update` in one shot. When the self-update phase applies a new version, `tuck update` re-execs the freshly-installed binary so the remaining phases run under the new code (with a `TUCK_UPDATE_RESUMED=1` loop guard). `--install-deps` is passed implicitly to the restore phase so umbrella refreshes install any missing tools as part of the same sweep.

See [Command Reference — tuck update](./Command-Reference#tuck-update) for flags, and [Recipes — Run `tuck update` on a schedule](./Recipes#run-tuck-update-on-a-schedule) for a cron / systemd-timer recipe.

## See also

- [Command Reference — tuck bootstrap](./Command-Reference#tuck-bootstrap)
- [Command Reference — tuck bootstrap update](./Command-Reference#tuck-bootstrap-update)
- [Command Reference — tuck bootstrap bundle](./Command-Reference#tuck-bootstrap-bundle)
- [Command Reference — tuck update](./Command-Reference#tuck-update)
- [Recipes — Add a new tool to your bootstrap.toml](./Recipes#add-a-new-tool-to-your-bootstraptoml)
- [Recipes — Bootstrap a fresh dev VM](./Recipes#bootstrap-a-fresh-dev-vm)
