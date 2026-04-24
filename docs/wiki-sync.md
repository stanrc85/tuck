# Wiki Sync — Editor's Guide

The tuck wiki lives at https://github.com/stanrc85/tuck/wiki. The **source of truth** is `docs/wiki/*.md` in this repo. A GitHub Actions workflow (`.github/workflows/publish-wiki.yml`) syncs pushes to `main` that touch `docs/wiki/` into the wiki repo (`stanrc85/tuck.wiki.git`) automatically.

## The ground rules

- **Edit `docs/wiki/<Page>.md` in this repo.** Never edit pages via the GitHub Wiki UI — those edits are overwritten on the next sync.
- **README at repo root is the landing page.** Keep it ≤200 lines and link into the wiki for depth.
- **One file per wiki page.** Filename must match the page title with spaces replaced by `-` (GitHub Wiki convention). `Command-Reference.md` becomes the wiki page `Command-Reference`.
- **Cross-links between wiki pages** use relative paths: `[Title](./Other-Page)` (note: leading `./`, no `.md` extension — both forms work on github.com but the no-extension form also works once the file is published as a wiki page).
- **Links back to source** use absolute URLs: `[config.schema.ts](https://github.com/stanrc85/tuck/blob/main/src/schemas/config.schema.ts)`. That way wiki readers (who don't have the repo checked out) can still follow them.

## Which doc lives where?

| Content                                       | Lives in                                       |
| --------------------------------------------- | ---------------------------------------------- |
| Landing page + 30-second pitch                | `README.md`                                    |
| User-facing deep reference                    | `docs/wiki/<Page>.md` → published to wiki      |
| Contributor reference (module map, data formats, provider interface) | `docs/wiki/Architecture.md` → published to wiki |
| Agent-facing conventions (AI workflows)       | `CLAUDE.md`, `AGENTS.md`                       |
| Running tests / benchmarks / tuck doctor plan | `docs/TESTING.md`, `docs/BENCHMARKING.md`, etc. |
| Error code reference                          | `docs/ERROR_CODES.md`                          |
| Man pages                                     | `docs/man/`                                    |

If you're about to write new user-facing docs, the question to ask is: "is this orientation / quick-pitch content, or deep reference?" Orientation goes in README; reference goes in `docs/wiki/`.

## Adding a new wiki page

1. Create `docs/wiki/New-Page-Title.md` (spaces → dashes, matching the page title you want).
2. Add a link from `docs/wiki/Home.md` under the appropriate section ("By topic" grid and/or "By question" FAQ).
3. Commit on a feature branch, open a PR, merge to `main`.
4. CI syncs the page to the wiki on merge. First-time-added pages show up within ~30 seconds at `https://github.com/stanrc85/tuck/wiki/New-Page-Title`.

Renames:

1. `git mv docs/wiki/Old-Name.md docs/wiki/New-Name.md`.
2. Update incoming links in Home.md and any other page that references the old name.
3. Merge. The sync removes the old page and creates the new one — note that any external bookmarks to the old page will 404 until someone recreates a redirect stub (GitHub Wiki has no native redirects).

Deletes:

1. `git rm docs/wiki/Page.md`.
2. Update Home.md and any incoming links.
3. Merge. The sync deletes the page from the wiki.

## Adding or updating a feature — the docs checklist

When a feature lands, touch the wiki in the same PR as the code:

- [ ] **Command Reference** — new command? New flag? Add it under the right heading with synopsis + flags + example.
- [ ] **Relevant topic page** — new config field goes in Configuration Reference; new behavior on sync goes in Command Reference + (if it changes the mental model) the relevant topic page.
- [ ] **Recipes** — if this enables a workflow users will want to discover, add a recipe or extend an existing one.
- [ ] **Architecture** — new library module, new on-disk format, new provider, new `SnapshotKind`, new `STATE_VERSION`? Extend the relevant section so contributors don't rediscover it from source.
- [ ] **Home.md** — new page? Link it from the navigation grids.
- [ ] **README** — only touch README when changing the top-level pitch, the top-8 commands table, or the "what's new" hero. Most feature changes don't need README edits.

## The sync workflow

`.github/workflows/publish-wiki.yml` does the sync via [`Andrew-Chen-Wang/github-wiki-action@v4`](https://github.com/marketplace/actions/wiki-action). The default `GITHUB_TOKEN` has `contents: write` scope for the same-project wiki, so no additional secret is needed.

Triggers:

- Any push to `main` that touches `docs/wiki/**` OR the workflow file itself.
- `workflow_dispatch` — manual trigger from the Actions tab if you ever need to force a resync.

If the sync fails:

- **Wiki not initialized** — most common cause. Visit the repo's Wiki tab and create any placeholder page (literally just "foo") so the wiki repo exists. Re-run the workflow.
- **Permissions error** — check that repo settings allow workflows to write (`Settings → Actions → General → Workflow permissions → Read and write`).
- **Rate limited** — rare for wiki ops, but possible on a rapid sequence of merges. The `concurrency` key in the workflow deduplicates overlapping runs.

## Style conventions

Established in the initial write; keep these when adding pages:

- **Voice:** direct, second-person instructional (`run X`, `your dotfiles`). Avoid marketing-speak.
- **Code blocks:** always language-tagged (` ```bash`, ` ```json`, ` ```toml`, etc.) so the syntax highlighting in the rendered wiki lights up.
- **Tables** for option/flag reference. Prose for narrative.
- **Cross-link liberally** at the bottom of each page in a "See also" section. The reader came in on one page; give them three escape hatches.
- **"Behavior notes"** subsections for non-obvious runtime behavior (retry loops, exit codes, side effects on snapshots, etc.).
- **Don't duplicate** between Command Reference and topic pages. Command Reference is the canonical flag list; topic pages link into it. The inverse path: deep "why this flag exists" context lives on the topic page; Command Reference links out.
