# Windows Support

tuck runs on Windows as a first-class platform. The same commands work; a few behaviors adapt to Windows conventions.

## Supported dotfiles on Windows

Auto-detection covers the common Windows config paths:

| Category     | Files                                                                 |
| ------------ | --------------------------------------------------------------------- |
| **Shell**    | PowerShell profiles (`Microsoft.PowerShell_profile.ps1`, `profile.ps1`) |
| **Terminal** | Windows Terminal `settings.json`, ConEmu/Cmder configs                |
| **Editors**  | VS Code, Cursor, Neovim (under `%LOCALAPPDATA%`)                      |
| **Git**      | `.gitconfig`, `.gitignore_global`                                     |
| **SSH**      | `%USERPROFILE%\.ssh\config`                                           |
| **Misc**     | WSL config (`.wslconfig`), Docker Desktop, Kubernetes kubeconfig      |

Run `tuck scan` to see what's detected on the current host.

## Windows-specific behavior

### Symlinks → Junctions

Windows symlinks require administrator privileges to create. To avoid that friction, tuck uses **directory junctions** (which don't) for directories. Individual files fall back to **copy** when the `symlink` strategy is set — a symlinked single file on Windows would also require admin.

**What this means in practice:** if you set `files.strategy = "symlink"` on Windows, directories get junctioned (behaves like a symlink for most purposes) and files get copied (same as default). The net effect is "directories stay in sync automatically, files need `tuck sync` to propagate."

### Permissions

Unix-style file permissions (`chmod`, the execute bit, etc.) don't apply on Windows. tuck silently skips any permission-preserving logic on Windows paths; this only matters when you're syncing a repo that holds files with meaningful Unix modes (e.g., `~/.ssh/config` at 0600) onto a Windows host — the Windows copy won't enforce the mode. Your SSH client probably doesn't care.

### Path expansion

Windows environment variables are expanded automatically:

- `%APPDATA%` → `C:\Users\<you>\AppData\Roaming`
- `%LOCALAPPDATA%` → `C:\Users\<you>\AppData\Local`
- `%USERPROFILE%` → `C:\Users\<you>` (equivalent to `~` on Unix)

Paths you pass to `tuck add`, `.tuckignore`, and config globs can use either `%VAR%` syntax or `~/` — tuck normalizes both.

### Hooks

[Hook commands](./Hooks) run via:

- `pwsh` (PowerShell Core) if available — preferred.
- Else `powershell` (Windows PowerShell 5.x) as a fallback.

If your hooks need to work on both Windows and Unix, either:

- Keep hooks short and portable (use `git`-y commands; avoid shell-specific idioms)
- Or split hooks per-host via `.tuckrc.local.json` (see [Host Groups — Defaults](./Host-Groups#defaults--per-host-vs-shared-config))

## PowerShell profile merging

Dotfiles that are 100% identical across hosts are easy. Dotfiles with a couple of host-specific lines are harder — you don't want the work-laptop PowerShell path mappings leaking to your home machine, but you also don't want to fork the whole profile.

tuck supports **preserve markers** for PowerShell profiles. Any block between `<# tuck:preserve #>` and `<# /tuck:preserve #>` is preserved on the local host during merges (apply / restore operations that would overwrite it).

```powershell
# Shared content — tracked in the repo, applies everywhere
function prompt { "PS $(Get-Location)> " }
Set-Alias ll Get-ChildItem

<# tuck:preserve #>
# Machine-specific content — stays on the current host, not overwritten
Set-Alias code "C:\Program Files\Microsoft VS Code\Code.exe"
$env:PATH += ";C:\work-specific\bin"
<# /tuck:preserve #>
```

When `tuck apply` or `tuck restore` would overwrite a profile that has preserve blocks:

1. tuck reads the existing local profile and extracts every preserve block.
2. It reads the incoming profile from the repo.
3. It concatenates: incoming profile + preserved blocks from local.
4. Writes the merged result back.

Preserve markers are PowerShell-specific today. Host-group splitting (one file per host via `tuck group`) is the multi-shell equivalent — see [Host Groups](./Host-Groups).

## WSL notes

**Running tuck inside WSL** — tuck treats WSL as a Linux host. Install via the standard install script; the Linux binary works directly.

**Running tuck in both native Windows AND WSL** — these are independent tuck installs pointed at different home directories (`C:\Users\<you>` vs `/home/<you>`), so they can track the same dotfiles repo via separate `~/.tuck/` working copies. Two things to watch:

- **Don't run `tuck restore --all` in both environments for the same files.** The WSL-side tuck will write `~/.zshrc` into WSL's `/home/<you>/.zshrc`; the Windows-side tuck has no business touching that path (and won't, by default — it scans Windows paths only).
- **Line endings.** Files synced from WSL have LF endings; files synced from Windows PowerShell might get CRLF depending on your git config (`core.autocrlf`). Either set `core.autocrlf=input` in your shared `.gitconfig` or keep the tuck repo's files always-LF and let git normalize on checkout.

**WSL2 + Docker Desktop** — `.wslconfig` at `%USERPROFILE%\.wslconfig` is detected as a Misc-category dotfile and tracks like anything else.

## Known limitations

- **Binary signing status:** tuck binaries aren't code-signed on Windows. SmartScreen may flag the install; right-click → Properties → Unblock if it does. (The npm tarball install avoids this because it comes from npm.)
- **Long paths:** some operations on paths > 260 chars need Windows long-path support enabled. Turn it on via `git config --system core.longpaths true` and the Windows registry `LongPathsEnabled` setting.
- **Case-insensitive filesystems:** Windows (and macOS by default) treat `.ZSHRC` and `.zshrc` as the same file. On a case-sensitive Linux host that shares the same tuck repo, this can produce "phantom" diff results. Keep source paths consistently lowercase where possible.

## See also

- [Getting Started](./Getting-Started)
- [Configuration Reference — files](./Configuration-Reference#files) — `strategy` options
- [Hooks](./Hooks)
- [Host Groups](./Host-Groups) — for per-OS dotfile splitting
