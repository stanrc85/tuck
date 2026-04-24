# tuck Wiki

**tuck** is a modern dotfiles manager — git-native, safe by default, cross-platform, with a terminal UX that doesn't feel like a chore. If this is your first visit, start with **[Getting Started](./Getting-Started)**. If you're looking for a specific flag, jump to **[Command Reference](./Command-Reference)**. If you want a worked solution to a specific problem, try **[Recipes](./Recipes)**.

## Start here

- **[Getting Started](./Getting-Started)** — install, first sync, fresh-host restore
- **[Command Reference](./Command-Reference)** — every command, every flag, with examples
- **[Recipes](./Recipes)** — "I want to …" cookbook

## By topic

| Page | What it covers |
|---|---|
| [Getting Started](./Getting-Started) | Install, `tuck init`, your first sync, restoring on a new machine |
| [Command Reference](./Command-Reference) | Canonical list of all commands + flags + examples |
| [Host Groups](./Host-Groups) | Tag files per machine, producer/consumer setups, `readOnlyGroups` |
| [Bootstrapping Tools](./Bootstrapping-Tools) | `bootstrap.toml` schema, built-in catalog, bundles, update lifecycle |
| [Configuration Reference](./Configuration-Reference) | Full `.tuckrc.json` schema, shared vs local, file strategies |
| [Time Machine & Undo](./Time-Machine-and-Undo) | Snapshots, retention, recovery recipes |
| [Git Providers](./Git-Providers) | GitHub, GitLab (incl. self-hosted), Gitea, local-only |
| [Windows Support](./Windows-Support) | PowerShell merging, junctions, WSL notes |
| [Security & Secrets](./Security-and-Secrets) | Secret scanning, placeholders, external managers |
| [Cheatsheet](./Cheatsheet) | `tuck cheatsheet` — parsers, JSON format, consumer recipes |
| [Hooks](./Hooks) | `preSync` / `postSync` / `preRestore` / `postRestore` |
| [Recipes](./Recipes) | Task-oriented cookbook |
| [Architecture](./Architecture) | Contributor-facing: module map, data formats, provider interface |

## By question

- **How do I set up tuck on a new host?** → [Getting Started](./Getting-Started)
- **How do I only apply some files on this machine?** → [Host Groups](./Host-Groups)
- **How do I install the CLI tools my dotfiles expect?** → [Bootstrapping Tools](./Bootstrapping-Tools)
- **I just broke something with `tuck restore` — help!** → [Time Machine & Undo](./Time-Machine-and-Undo)
- **Can tuck talk to my self-hosted GitLab?** → [Git Providers](./Git-Providers)
- **How do I run a script after every sync?** → [Hooks](./Hooks)
- **How do I keep secrets out of my committed dotfiles?** → [Security & Secrets](./Security-and-Secrets)
- **How do I catch a syntax error before it lands in git?** → [Recipes → Lint tracked files](./Recipes#lint-tracked-files-before-syncing)
- **Why is my shell startup slow?** → [Recipes → Profile and trim zsh](./Recipes#profile-and-trim-a-slow-zsh-startup)

## Contributing to these docs

The source lives at `docs/wiki/*.md` in the main repo. A GitHub Actions workflow syncs pushes to this wiki automatically — see [docs/wiki-sync.md](https://github.com/stanrc85/tuck/blob/main/docs/wiki-sync.md) for the editor's guide. **Do not edit pages via the GitHub Wiki UI** — those edits are overwritten on the next sync.
