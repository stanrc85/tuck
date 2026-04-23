<img src="public/Changelog.png" alt="Changelog" style="width:100%;">

# [2.20.0](https://github.com/stanrc85/tuck/compare/v2.19.0...v2.20.0) (2026-04-23)


### Features

* **diff:** side-by-side layout via -s flag ([93ba227](https://github.com/stanrc85/tuck/commit/93ba227e6316550d0a226b2e5d0ddd54b72b4b79))

# [2.19.0](https://github.com/stanrc85/tuck/compare/v2.18.3...v2.19.0) (2026-04-23)


### Features

* **diff:** summary header + git-style --stat bar graph ([4c0e19f](https://github.com/stanrc85/tuck/commit/4c0e19f280b4337fd1778c6142c7963ea2c971ca))

## [2.18.3](https://github.com/stanrc85/tuck/compare/v2.18.2...v2.18.3) (2026-04-23)


### Bug Fixes

* **security:** use Object.defineProperty in setNestedValue ([389ff4d](https://github.com/stanrc85/tuck/commit/389ff4d126fd3f63b06d3717d3ab91f40ecf25c5))

## [2.18.2](https://github.com/stanrc85/tuck/compare/v2.18.1...v2.18.2) (2026-04-22)


### Bug Fixes

* **security:** close remaining CodeQL findings in config + gitlab provider ([9ded18e](https://github.com/stanrc85/tuck/commit/9ded18e15a5ee6cbd940c461a519aef10f34f1ea)), closes [#13](https://github.com/stanrc85/tuck/issues/13) [#6](https://github.com/stanrc85/tuck/issues/6)

## [2.18.1](https://github.com/stanrc85/tuck/compare/v2.18.0...v2.18.1) (2026-04-22)


### Bug Fixes

* **security:** address CodeQL findings in CI permissions and URL parsing ([46f1b86](https://github.com/stanrc85/tuck/commit/46f1b86117b001d549176bd6a488ef8a0b65c370)), closes [#1-4](https://github.com/stanrc85/tuck/issues/1-4) [#18](https://github.com/stanrc85/tuck/issues/18) [#6](https://github.com/stanrc85/tuck/issues/6) [#7-8](https://github.com/stanrc85/tuck/issues/7-8)

# [2.18.0](https://github.com/stanrc85/tuck/compare/v2.17.3...v2.18.0) (2026-04-22)


### Features

* **bootstrap:** add updateVia:system to defer apt-managed tools from tuck update ([3e8b560](https://github.com/stanrc85/tuck/commit/3e8b5609be8fb650913b0fcb7ab7591fca4a2d08))

## [2.17.3](https://github.com/stanrc85/tuck/compare/v2.17.2...v2.17.3) (2026-04-22)


### Bug Fixes

* **bootstrap:** resolve ZIM_HOME in zimfw update script for XDG layouts ([7a14254](https://github.com/stanrc85/tuck/commit/7a14254e49b052b0af1677a943f7d799c2445747))

## [2.17.2](https://github.com/stanrc85/tuck/compare/v2.17.1...v2.17.2) (2026-04-22)


### Bug Fixes

* **git:** set GIT_TERMINAL_PROMPT via process.env, not simple-git .env() ([b591371](https://github.com/stanrc85/tuck/commit/b59137173f891b8025848770e5c4a5d1f3d38441))

## [2.17.1](https://github.com/stanrc85/tuck/compare/v2.17.0...v2.17.1) (2026-04-22)


### Bug Fixes

* **git:** preserve process.env when setting GIT_TERMINAL_PROMPT ([03f08ad](https://github.com/stanrc85/tuck/commit/03f08ad1e2cf5e84c5e69b1bcddd3ed24fe10435))

# [2.17.0](https://github.com/stanrc85/tuck/compare/v2.16.1...v2.17.0) (2026-04-22)


### Features

* **config:** add readOnlyGroups consumer-host guardrail ([68196e4](https://github.com/stanrc85/tuck/commit/68196e41833eb28866d7e01e8bec30585736fe8b))

## [2.16.1](https://github.com/stanrc85/tuck/compare/v2.16.0...v2.16.1) (2026-04-22)


### Bug Fixes

* **git:** prevent sync hang on hosts without git credentials ([dec3cce](https://github.com/stanrc85/tuck/commit/dec3cce6fa8323204777162b763ae8d4aedd1d48))

# [2.16.0](https://github.com/stanrc85/tuck/compare/v2.15.0...v2.16.0) (2026-04-22)


### Features

* **cheatsheet:** add --format json output for jq/fzf consumers ([2c381b6](https://github.com/stanrc85/tuck/commit/2c381b66eabcf4cff2b4daac90bdcb3906301640))

# [2.15.0](https://github.com/stanrc85/tuck/compare/v2.14.0...v2.15.0) (2026-04-21)


### Features

* **bootstrap:** install mason-tool-installer ensure_installed list in neovim-plugins ([4466214](https://github.com/stanrc85/tuck/commit/44662149ef035b4848e81ea9d093aadfb23dbed0))

# [2.14.0](https://github.com/stanrc85/tuck/compare/v2.13.0...v2.14.0) (2026-04-21)


### Features

* **init:** describe what restore --bootstrap will do before prompting ([1df2589](https://github.com/stanrc85/tuck/commit/1df258931f32ad31d5ff7a233df00b2f23ac4a3e))

# [2.13.0](https://github.com/stanrc85/tuck/compare/v2.12.2...v2.13.0) (2026-04-21)


### Features

* **restore:** unify fresh-host flow via --bootstrap -g <group> ([8c50fbc](https://github.com/stanrc85/tuck/commit/8c50fbc854f8b1908a0711481281b6f1dc3d10f7))

## [2.12.2](https://github.com/stanrc85/tuck/compare/v2.12.1...v2.12.2) (2026-04-21)


### Bug Fixes

* **bootstrap:** fire chsh prompt before throwing on partial failures ([f29b672](https://github.com/stanrc85/tuck/commit/f29b67268d4b620a42248867e8fd491be1ce83c8))

## [2.12.1](https://github.com/stanrc85/tuck/compare/v2.12.0...v2.12.1) (2026-04-21)


### Bug Fixes

* **bootstrap:** read login shell from /etc/passwd, not $SHELL ([d3e4392](https://github.com/stanrc85/tuck/commit/d3e43922594ec4ff3c79df8d677f1313a9253c33))

# [2.12.0](https://github.com/stanrc85/tuck/compare/v2.11.0...v2.12.0) (2026-04-21)


### Features

* **bootstrap:** add tealdeer as a built-in registry tool ([1fba225](https://github.com/stanrc85/tuck/commit/1fba22524bc66a36f14aae30b1221a087ad92ba1))

# [2.11.0](https://github.com/stanrc85/tuck/compare/v2.10.3...v2.11.0) (2026-04-21)


### Features

* **bootstrap:** scan restored rc content for rcReferences; zimfw dual path ([b186743](https://github.com/stanrc85/tuck/commit/b1867435fee39568415218c1f19e5356834ddfbc))

## [2.10.3](https://github.com/stanrc85/tuck/compare/v2.10.2...v2.10.3) (2026-04-21)


### Bug Fixes

* **bootstrap:** bat cache rebuild, pet check simplification, zimfw XDG path ([e3743dc](https://github.com/stanrc85/tuck/commit/e3743dc2e0bf95cf986508ebbff27d18ded27f93))

## [2.10.2](https://github.com/stanrc85/tuck/compare/v2.10.1...v2.10.2) (2026-04-21)


### Bug Fixes

* **bootstrap:** stop upstream zimfw installer from running its own chsh ([fb15a27](https://github.com/stanrc85/tuck/commit/fb15a273a761bdf6d83712ecb39232e40d06a16e))

## [2.10.1](https://github.com/stanrc85/tuck/compare/v2.10.0...v2.10.1) (2026-04-21)


### Bug Fixes

* **bootstrap:** kali skip-guard for zimfw and XDG path matching for zsh ([fcad21c](https://github.com/stanrc85/tuck/commit/fcad21ccfa41eaec7a14fac6ed027fee4b555ebf))

# [2.10.0](https://github.com/stanrc85/tuck/compare/v2.9.0...v2.10.0) (2026-04-21)


### Features

* **bootstrap:** add zsh and zimfw as built-in registry tools ([616939f](https://github.com/stanrc85/tuck/commit/616939f85e30180917357b4151d20859408af628))

# [2.9.0](https://github.com/stanrc85/tuck/compare/v2.8.1...v2.9.0) (2026-04-21)


### Features

* new-host UX fixes for init/config/restore/bootstrap ([c56a840](https://github.com/stanrc85/tuck/commit/c56a840d4a2d71e52415231e936f8d0de10603fc))

## [2.8.1](https://github.com/stanrc85/tuck/compare/v2.8.0...v2.8.1) (2026-04-21)


### Bug Fixes

* **ui:** release @clack/prompts spinner process listeners on stop ([9b56549](https://github.com/stanrc85/tuck/commit/9b56549bccbc2f692fd7b5bb399e5bef187da15f))

# [2.8.0](https://github.com/stanrc85/tuck/compare/v2.7.2...v2.8.0) (2026-04-21)


### Features

* **cheatsheet:** promote trailing comments to action + capture section headers ([ae381ed](https://github.com/stanrc85/tuck/commit/ae381ed9711e2da1151b6f07cc804d62160ae143))

## [2.7.2](https://github.com/stanrc85/tuck/compare/v2.7.1...v2.7.2) (2026-04-21)


### Bug Fixes

* **cheatsheet:** yazi v26 schema + lazy.nvim keys + suppress `n ` prefix ([40f03d6](https://github.com/stanrc85/tuck/commit/40f03d6de7809cb4879eb61528d0d0daff2bcc3e))

## [2.7.1](https://github.com/stanrc85/tuck/compare/v2.7.0...v2.7.1) (2026-04-21)


### Bug Fixes

* **cheatsheet:** walk tracked directories instead of treating them as files ([623b5ef](https://github.com/stanrc85/tuck/commit/623b5ef232cdda58bdcd2625b273a7c91d2bd6b5))

# [2.7.0](https://github.com/stanrc85/tuck/compare/v2.6.0...v2.7.0) (2026-04-21)


### Features

* **cheatsheet:** add `tuck cheatsheet` command with tmux/zsh/yazi parsers ([a5d868e](https://github.com/stanrc85/tuck/commit/a5d868e4933b71bdaa7fb2e90442d7106741632c))
* **cheatsheet:** add neovim-lua parser for vim.keymap.set calls ([bd2f820](https://github.com/stanrc85/tuck/commit/bd2f82091843f39d90bee2df08967e2aa9a7f7b2))

# [2.6.0](https://github.com/stanrc85/tuck/compare/v2.5.0...v2.6.0) (2026-04-21)


### Bug Fixes

* **bootstrap:** normalize separators in associatedConfig glob matcher ([c6c27b6](https://github.com/stanrc85/tuck/commit/c6c27b6576d2865741cb905a152f0803a2d62844))


### Features

* **bootstrap:** add bundle subcommand for CLI-driven [bundles] edits ([d96cc9b](https://github.com/stanrc85/tuck/commit/d96cc9bfae3af4404ac784362e9d3fc0c2349dd0))
* **bootstrap:** add ripgrep as a built-in tool ([581e320](https://github.com/stanrc85/tuck/commit/581e3201488a4429468ad80a7846a4f0ec440f1a))
* **restore:** prompt to install missing tool deps at restore tail ([549627e](https://github.com/stanrc85/tuck/commit/549627e210bd4ad8e406b7a2070af7120fd411aa))

# [2.5.0](https://github.com/stanrc85/tuck/compare/v2.4.0...v2.5.0) (2026-04-21)


### Features

* **git:** add divergence gate and --mirror force-reset pull mode ([f2a8cb1](https://github.com/stanrc85/tuck/commit/f2a8cb1389c1071443f31d89c76a198c4a90ffb2))
* **init:** auto-detect OS ID and offer to seed defaultGroups ([6d9e3cf](https://github.com/stanrc85/tuck/commit/6d9e3cfca86cf0a4e38f0f2cb31f40f47ee8f066))

# [2.4.0](https://github.com/stanrc85/tuck/compare/v2.3.2...v2.4.0) (2026-04-20)


### Features

* **bootstrap:** install neovim from GitHub stable tag instead of apt ([23a9f79](https://github.com/stanrc85/tuck/commit/23a9f792aaa97f850011338735fafc71b22d860c))

## [2.3.2](https://github.com/stanrc85/tuck/compare/v2.3.1...v2.3.2) (2026-04-20)


### Bug Fixes

* **bootstrap:** bump yazi pin to v26.1.22 to match CalVer plugin API ([4abd92b](https://github.com/stanrc85/tuck/commit/4abd92b4bc6e919026b9487fa33dafa87ab8c853))

## [2.3.1](https://github.com/stanrc85/tuck/compare/v2.3.0...v2.3.1) (2026-04-20)


### Bug Fixes

* **bootstrap:** survive nvim-treesitter API drift in neovim-plugins install ([e238816](https://github.com/stanrc85/tuck/commit/e238816ceb2915d17e5b7beff2ca9cb3763d6736))

# [2.3.0](https://github.com/stanrc85/tuck/compare/v2.2.2...v2.3.0) (2026-04-20)


### Features

* **groups:** gate sync/push on host group assignment + prompt during restore ([bcfb9aa](https://github.com/stanrc85/tuck/commit/bcfb9aa35e0d1e2db9922049aeb4247df4c04813))

## [2.2.2](https://github.com/stanrc85/tuck/compare/v2.2.1...v2.2.2) (2026-04-20)


### Bug Fixes

* **git:** autostash on pull --rebase to survive incidental workdir dirt ([28c0f98](https://github.com/stanrc85/tuck/commit/28c0f98116b9204f599f82bf277f00eb12e63658))

## [2.2.1](https://github.com/stanrc85/tuck/compare/v2.2.0...v2.2.1) (2026-04-20)


### Bug Fixes

* **bootstrap:** drop unknown ripgrep from minimal bundle in full.example ([fce5065](https://github.com/stanrc85/tuck/commit/fce5065e800f2935c1fc9be25a1b1afe5f45981e))
* **bootstrap:** neovim-plugins check reflects actual lazy install state ([5d2084e](https://github.com/stanrc85/tuck/commit/5d2084eb04968b1f07ca4c30ebe00fba6af89301))
* **errors:** surface underlying git error in GitError message ([4652239](https://github.com/stanrc85/tuck/commit/46522395b189eb3bb647840988c08404d2f9573a))

# [2.2.0](https://github.com/stanrc85/tuck/compare/v2.1.1...v2.2.0) (2026-04-20)


### Features

* add tuck update umbrella and tuck bootstrap update subcommand ([6abb424](https://github.com/stanrc85/tuck/commit/6abb4247e57141beea25043bcceac08ac92a0aa6))
* **bootstrap:** add fd built-in with fdfind symlink ([4914f07](https://github.com/stanrc85/tuck/commit/4914f07bd203946ed529e8344015923cb9b1f8b0))

## [2.1.1](https://github.com/stanrc85/tuck/compare/v2.1.0...v2.1.1) (2026-04-20)


### Bug Fixes

* **bootstrap:** gitignore .bootstrap-state.json so install state stays per-host ([ceb6d8a](https://github.com/stanrc85/tuck/commit/ceb6d8afb4acce1747175ffcc1219a1999114957))
* **bootstrap:** make bootstrap.toml optional when using the default path ([9745cb6](https://github.com/stanrc85/tuck/commit/9745cb62725328c76c80c2d6ae4e1b050d8df5f6))

# [2.1.0](https://github.com/stanrc85/tuck/compare/v2.0.0...v2.1.0) (2026-04-20)


### Bug Fixes

* **bootstrap:** align registry entries with deploy_dots.sh behavior ([a741313](https://github.com/stanrc85/tuck/commit/a7413132a472e8c5415cfd08dfc48dbfa127eb31))


### Features

* **bootstrap:** add built-in registry scaffolding and merge ([fbeecb0](https://github.com/stanrc85/tuck/commit/fbeecb08f0c92774e82259db575eac46314bdbfe))
* **bootstrap:** add parser, interpolator, and resolver foundations ([bb04aa3](https://github.com/stanrc85/tuck/commit/bb04aa39ef07b0f2464e0bfd3c12ca377f8f77b4))
* **bootstrap:** add plan + execute orchestration layer ([92e2b02](https://github.com/stanrc85/tuck/commit/92e2b02d659ef09560feb8345c3e3cea61397f67))
* **bootstrap:** add script runner for check/install/update ([a4c6261](https://github.com/stanrc85/tuck/commit/a4c6261490e2b53c125d3ae05f8385f9666c27ff))
* **bootstrap:** add state file and detection modules ([0b09b0a](https://github.com/stanrc85/tuck/commit/0b09b0a1209c8e6c9d60d87e0c967039786e3533))
* **bootstrap:** add tuck bootstrap command with picker + flag modes ([af99034](https://github.com/stanrc85/tuck/commit/af9903460f78c7950a45b1b6df5f0e9b0e5a939f))
* **bootstrap:** populate built-in registry with 7 tool entries ([e29b0ff](https://github.com/stanrc85/tuck/commit/e29b0ff8d5a956a5aa165dbcf083895e6311c2f6))

# [2.0.0](https://github.com/stanrc85/tuck/compare/v1.5.0...v2.0.0) (2026-04-19)


### Bug Fixes

* **doctor:** harden pnpm check for cross-platform CI runners ([ebf8871](https://github.com/stanrc85/tuck/commit/ebf887161874998efd12ec26896f1f49732de026))
* **doctor:** resolve pnpm.cmd on windows for availability check ([0f926fe](https://github.com/stanrc85/tuck/commit/0f926fe466d0f50018b6b64960d29c76198ec97c))


* refactor(config)!: remove dead templates scaffolding ([bca3870](https://github.com/stanrc85/tuck/commit/bca3870c34cd2e601b8fdf12096095694f4dafdb))
* feat(backups)!: move snapshots out of synced repo, drop legacy backup module ([3502a84](https://github.com/stanrc85/tuck/commit/3502a84ea7116ba9729f068a9140b4f3b88f25e7))


### Features

* **config:** allow hooks block in .tuckrc.local.json for per-host hooks ([1b8a514](https://github.com/stanrc85/tuck/commit/1b8a514a688e8e2703f2e47109d46bfaa2528270))
* **doctor:** close plan gaps — pnpm, gh CLI, and hooks trust model ([b37a26b](https://github.com/stanrc85/tuck/commit/b37a26b61ffc129345129cb25ce88801f0a74eea))
* **doctor:** warn when defaultGroups leaks via shared .tuckrc.json ([c4f9622](https://github.com/stanrc85/tuck/commit/c4f9622e23cae890c76ab4e99a470d391d992424))


### BREAKING CHANGES

* config.templates and manifest trackedFile.template
removed from schemas. Existing configs/manifests load fine (unknown
keys silently stripped) but the fields are no longer available to read
or set via tuck config. Anyone who had hand-written values in templates
will find them silently ignored — there was never a code path that
applied them, so behavior is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
* Snapshots relocated from ~/.tuck/backups/ to
~/.tuck-backups/. Auto-migration handles the move transparently on first
post-upgrade invocation; no user action required. `config.files.backupDir`
is no longer read (silently stripped on config load).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

# [1.5.0](https://github.com/stanrc85/tuck/compare/v1.4.0...v1.5.0) (2026-04-19)


### Features

* default restore/apply/list/diff to config.defaultGroups when -g is omitted ([c3bfb16](https://github.com/stanrc85/tuck/commit/c3bfb165b405708973267255f1ec6d3f01905164))

# [1.4.0](https://github.com/stanrc85/tuck/compare/v1.3.0...v1.4.0) (2026-04-19)


### Features

* **config:** split host-local config into .tuckrc.local.json ([a2f6ebd](https://github.com/stanrc85/tuck/commit/a2f6ebd6b4863fb3e8c036d2165b4da7233923c9))
* **sync:** add --list flag to preview what tuck sync would touch ([dc110df](https://github.com/stanrc85/tuck/commit/dc110dfb4a32dcc619786b1e4821e6365c92c1a6))
* **sync:** scope tuck sync by host-group via -g flag and defaultGroups ([11cdd31](https://github.com/stanrc85/tuck/commit/11cdd31caba64f1e4302a3dc986db694a0191237))

# [1.3.0](https://github.com/stanrc85/tuck/compare/v1.2.0...v1.3.0) (2026-04-19)


### Features

* **doctor:** add env.tty-capability check ([77d8254](https://github.com/stanrc85/tuck/commit/77d82547602e345afb5cb6f556567e122cfb3824))
* **doctor:** add repo.branch-tracking check ([a8466aa](https://github.com/stanrc85/tuck/commit/a8466aab215ae35dc0c78a0fb8d2bbb9a39710ae))
* **self-update:** add tuck self-update command ([d3f9552](https://github.com/stanrc85/tuck/commit/d3f9552441ad095874f6fd1bd3de7cb0d33cae8c))

# [1.2.0](https://github.com/stanrc85/tuck/compare/v1.1.0...v1.2.0) (2026-04-18)


### Features

* **undo:** generalize undo across every destructive op with kind-tagged snapshots ([4b0848e](https://github.com/stanrc85/tuck/commit/4b0848e42211b97c76d9b6956b16f7484baeaf4b))

# [1.1.0](https://github.com/stanrc85/tuck/compare/v1.0.4...v1.1.0) (2026-04-18)


### Features

* **clean:** add tuck clean to remove orphaned files from the repo ([6081c38](https://github.com/stanrc85/tuck/commit/6081c38cca83519941114823d27d5ec74c9e8d59))

## [1.0.4](https://github.com/stanrc85/tuck/compare/v1.0.3...v1.0.4) (2026-04-18)


### Bug Fixes

* **restore:** fail fast on non-interactive prompt instead of hanging ([3abe37f](https://github.com/stanrc85/tuck/commit/3abe37f07cfe92c6c05d00444d401ba123a3406b))

## [1.0.3](https://github.com/stanrc85/tuck/compare/v1.0.2...v1.0.3) (2026-04-18)


### Bug Fixes

* **ui:** fall back to plain logs when stdout/stdin isn't a TTY ([826f7e4](https://github.com/stanrc85/tuck/commit/826f7e4305a840f756d563c489850e209012b3cd))

## [1.0.2](https://github.com/stanrc85/tuck/compare/v1.0.1...v1.0.2) (2026-04-18)


### Bug Fixes

* **release:** ship pre-built tarball and ESM-compatible binaries ([495e9c7](https://github.com/stanrc85/tuck/commit/495e9c78aee6d58d62660e461b77adbf8c04f638))

## [1.0.1](https://github.com/stanrc85/tuck/compare/v1.0.0...v1.0.1) (2026-04-18)


### Bug Fixes

* **release:** generate SHA256SUMS and repair npm git install ([71e0ce6](https://github.com/stanrc85/tuck/commit/71e0ce6fdcaa0ee2bde5f8431d2f0bcb3ecd3bc5))

# 1.0.0 (2026-04-18)


### Bug Fixes

* add colors export to diff.test.ts mock ([7a4b4f2](https://github.com/stanrc85/tuck/commit/7a4b4f27a26fba84432dd07d320c2854b5d108b4))
* add longer timeouts for git tests on Windows CI ([a63a439](https://github.com/stanrc85/tuck/commit/a63a439eecabe063a55d0bb2860526377977454a))
* add missing semantic-release plugins and install script ([b5663c6](https://github.com/stanrc85/tuck/commit/b5663c60e6a6d200f4868f26f4c8a23583eaac13))
* add workflow_dispatch trigger to CI workflow ([b3f6976](https://github.com/stanrc85/tuck/commit/b3f69766ee2586f61f8c902a4b13106c20b75e4b))
* **add:** correct sensitive file pattern matching for paths with ~/ prefix ([af4372f](https://github.com/stanrc85/tuck/commit/af4372f24af2b85e66230eef5e392e93f0ad6de8))
* address additional Copilot code review feedback ([7a8dc65](https://github.com/stanrc85/tuck/commit/7a8dc65b27a77fe5224fe2d50f08bcc300b90ce3))
* address code review comments (simple fixes) ([6f47f34](https://github.com/stanrc85/tuck/commit/6f47f34294bb61d86936abb963ec9d25db329065))
* address code review feedback ([7b4393b](https://github.com/stanrc85/tuck/commit/7b4393b48a986f4d5c56b661583067b2a4dfe4c0))
* address code review feedback from PR[#29](https://github.com/stanrc85/tuck/issues/29) ([c615ef0](https://github.com/stanrc85/tuck/commit/c615ef05475773ddedb60570ceb235e694254d5e))
* address code review issues ([15834d0](https://github.com/stanrc85/tuck/commit/15834d0775ff8d270994262e26feaac5818b04cc))
* address code review issues for password manager integration ([9929af0](https://github.com/stanrc85/tuck/commit/9929af0e510b9ded5db8dac208c55e81144de739))
* address complex code review comments ([322d071](https://github.com/stanrc85/tuck/commit/322d071d040f7a332afe07a8438b915c5f98acf7))
* address comprehensive code review findings ([cbc37ac](https://github.com/stanrc85/tuck/commit/cbc37ac33e7a0feb3475e44341096df49a20bac1))
* address PR review comments - improve code quality, security, and type safety ([c1f1fdd](https://github.com/stanrc85/tuck/commit/c1f1fdd2c4d83edbf8ea6892bebe47ac19ed854a))
* address PR review comments - improve security docs, error messages, and code quality ([29bf6f3](https://github.com/stanrc85/tuck/commit/29bf6f3e3d338f897413ccb91d44e45806d456d8))
* address PR review comments - improve security, error messages, and validation ([e37a54d](https://github.com/stanrc85/tuck/commit/e37a54d48cc3eba7219c6d41ab7a2624b5186d37))
* address PR review comments - improve URL validation and token format ([dce5794](https://github.com/stanrc85/tuck/commit/dce579470e1e4909c75d02a95e8a890936b5a582))
* address PR review comments - security, type safety, and code quality improvements ([cf4ae39](https://github.com/stanrc85/tuck/commit/cf4ae392a61b9ccdc574fd4b85218f8efd833f82))
* address PR review comments and critical issues ([89c7c30](https://github.com/stanrc85/tuck/commit/89c7c30b28d575312517df4b5d62f671bab8ed94))
* address PR review feedback on secrets management ([ae945e9](https://github.com/stanrc85/tuck/commit/ae945e90ac1511d01b2618a4418631732f594d93))
* check stderr for GitHub CLI authentication status ([1219c0b](https://github.com/stanrc85/tuck/commit/1219c0bf207b18cb3a3e37e1dedba144eb4b1899))
* close remaining naming and credential safety gaps ([670e5d5](https://github.com/stanrc85/tuck/commit/670e5d5c0f2ffade52de09ede97bb514322ef3e6))
* comprehensive bug fixes and expanded test coverage ([e81c31f](https://github.com/stanrc85/tuck/commit/e81c31f2aaa358588d11be86821630c2c39c2ce7))
* correct comment inaccuracies from code review ([b29e60c](https://github.com/stanrc85/tuck/commit/b29e60c3d3b2ceb88baf4a3fd332f5eb14965909))
* correct dry_run boolean comparison in release workflow ([48a6d8a](https://github.com/stanrc85/tuck/commit/48a6d8a13b4d6e29df5e5ee6d107c9a0e65b58d4))
* correct glob pattern regex escaping for skip patterns ([60d48c0](https://github.com/stanrc85/tuck/commit/60d48c0b65364250f59edd2f960271cf151b7240))
* correct Homebrew tap name in README ([4807b47](https://github.com/stanrc85/tuck/commit/4807b47f3aab42cd9325ea06aacbb09980dc6ec3)), closes [#74](https://github.com/stanrc85/tuck/issues/74)
* correct inputs.dry_run check for push events ([d91771f](https://github.com/stanrc85/tuck/commit/d91771fc451866053ce5cd0a3cf4c4ed1d76271f))
* correct regex escaping and simplify success message logic ([79b4e83](https://github.com/stanrc85/tuck/commit/79b4e836026c8ec311c7614e8ff1dab10f93b03b))
* correct SSH/GPG permission checks in restore command ([9814283](https://github.com/stanrc85/tuck/commit/9814283e75d7202d3217410ff95b9857219e813b))
* enforce safe destination paths and harden test isolation ([11c167f](https://github.com/stanrc85/tuck/commit/11c167fdd28462d80ee7fc49aab4bff9757fd14d))
* extract GITHUB_TOKEN_PREFIXES constant and improve fallback logic ([232377c](https://github.com/stanrc85/tuck/commit/232377c5f65e1c8e284944a9deda505e433de503))
* extract MIN_GITHUB_TOKEN_LENGTH constant and restore username fallback ([7fd6c63](https://github.com/stanrc85/tuck/commit/7fd6c63cb9d481dbb49735847ce49ac9060d455f))
* **github:** add blank line terminator to git credential protocol input ([ba65ec7](https://github.com/stanrc85/tuck/commit/ba65ec78fe4642d4ab9508d5f6cd07d02f53396f))
* **github:** properly narrow token type in updateStoredCredentials ([17b3750](https://github.com/stanrc85/tuck/commit/17b3750b59de334db448e9c1af7a695c794cc4bd))
* handle dry-run mode correctly in version detection logic ([b776007](https://github.com/stanrc85/tuck/commit/b776007648da8aa384bd6f81c7d734bd8ce55598))
* harden manifest path validation and add doctor plan ([75d822a](https://github.com/stanrc85/tuck/commit/75d822a0d2a648c7454b35bdb262aae15123be4c))
* harden tracking pipeline and security safeguards ([289990b](https://github.com/stanrc85/tuck/commit/289990bf0c2c408ee51a438c95e66f1f22dc3f7f))
* implement --since option for scan-history command ([7ee42a7](https://github.com/stanrc85/tuck/commit/7ee42a7d93410894e9a1ca9ff7f733ca9f693025))
* implement security hardening and code quality improvements ([58df03a](https://github.com/stanrc85/tuck/commit/58df03a6fdf9e1a7e3fb9c6b524d02b033a3c938))
* improve doctor home and tuck directory checks ([62b9ba0](https://github.com/stanrc85/tuck/commit/62b9ba052fc689a20c47c5364a32cbca81b799c6))
* improve init flow with better GitHub error handling and file pre-selection ([250823f](https://github.com/stanrc85/tuck/commit/250823f478172d7932ae50e016fde0db4beb4e90))
* improve known_hosts parsing and clarify GitHub URL validation context ([b242381](https://github.com/stanrc85/tuck/commit/b24238100b7ac705169ef25110f8192192043cf6))
* improve known_hosts parsing to prevent hostname confusion ([fcd8577](https://github.com/stanrc85/tuck/commit/fcd8577757b0c0b24ee3dc816659c49f5cacee93))
* improve URL validation and username fallback logic ([dc95131](https://github.com/stanrc85/tuck/commit/dc951317038dda5753e9e349ad885972d7895726))
* improve URL validation regex and known_hosts parsing logic ([8c7e5b5](https://github.com/stanrc85/tuck/commit/8c7e5b577fc0e65110ba19790b8f2e51c082e56a))
* **init:** handle case where only sensitive files are detected ([3622302](https://github.com/stanrc85/tuck/commit/362230297772aa05be1ac8700484f1effaeb65b9))
* **init:** validate destination paths and copy plain-dotfiles repo contents ([8f61bca](https://github.com/stanrc85/tuck/commit/8f61bca849cc8f7e10cf918d1b7bf7ab267c7ce8))
* make addFilesFromPaths throw error on secrets detection ([d837c37](https://github.com/stanrc85/tuck/commit/d837c3792b67a415b31b6499e1d52ed6ed315569))
* make tests cross-platform for Windows CI ([88c7ae6](https://github.com/stanrc85/tuck/commit/88c7ae6513b0ae24423ad54f410e5d5f49935cdf))
* multiple bug fixes and UX improvements ([6f8e01d](https://github.com/stanrc85/tuck/commit/6f8e01d56644a16c429473364b7f5b11ab9985b1))
* preserve existing .gitignore and README.md in plain-dotfiles import ([d32dd96](https://github.com/stanrc85/tuck/commit/d32dd96bc8657ecf9175384a2a44d25fec52e121))
* prevent backup filename collisions in Time Machine snapshots ([5e3a1de](https://github.com/stanrc85/tuck/commit/5e3a1de48cfe38b78e517ea525fad2015ef99277))
* prevent duplicate secret storage when same value matched by multiple patterns ([8ea5870](https://github.com/stanrc85/tuck/commit/8ea5870c85f2f1149b96552ab6e7a917cfef2112))
* prevent shell injection in migration documentation examples ([5247088](https://github.com/stanrc85/tuck/commit/5247088267652f4768ab6323ecfcc942820eb5fa))
* remove redundant undefined and clarify GITHUB_TOKEN_PREFIXES usage ([29bf7d9](https://github.com/stanrc85/tuck/commit/29bf7d9d012ab34a347b07be726ad94718f1f630))
* remove unused imports and variables (lint errors) ([aca6079](https://github.com/stanrc85/tuck/commit/aca60797d3e936609cd7917e3e38caf15444d902))
* remove unused variables and imports from test files ([7bc2543](https://github.com/stanrc85/tuck/commit/7bc25438231f928fb1eb858fdf468377147b614c))
* reset regex lastIndex in hasPlaceholders to prevent state pollution ([98cf7c8](https://github.com/stanrc85/tuck/commit/98cf7c8cffe31c75ebdff736467179050cdeb898))
* resolve diff command issues from PR review ([3d298fc](https://github.com/stanrc85/tuck/commit/3d298fcc73dd5be23b43f24015615e8a12c5a3c9))
* resolve ESLint errors in table.ts ([c158c4c](https://github.com/stanrc85/tuck/commit/c158c4c6adff5bac73ae5ef9a6bffe873b2d3e09))
* resolve ESLint warnings in validation utilities ([fbbc76a](https://github.com/stanrc85/tuck/commit/fbbc76a01acb4f753d97885f4cc194a6af16276c))
* resolve lint errors and remove remotion/video files ([968a290](https://github.com/stanrc85/tuck/commit/968a2902b8dac0d4a2a33ff1b5e4808fd703bad5))
* resolve multiple logic gaps and safety issues ([4980175](https://github.com/stanrc85/tuck/commit/498017592423b141c25e7b3e0ab91170dbabf82d))
* resolve npm publish permission error and fix release pipeline ([2c69c9b](https://github.com/stanrc85/tuck/commit/2c69c9b4df31c90827623867db7610a35a7255e9))
* resolve undefined variable and type errors in progress tracking ([e3fd023](https://github.com/stanrc85/tuck/commit/e3fd02341518f290c0ba04ac93a321386faa2db1))
* resolve Windows test failures in paths.test.ts ([85ac358](https://github.com/stanrc85/tuck/commit/85ac3583f14917966970cf151615522ee30e2aa4))
* resolve Windows test failures in paths.test.ts ([f103c67](https://github.com/stanrc85/tuck/commit/f103c676cde62a1e0e529c7b4506670969dd9686))
* restore provider parameter in validateRepoName ([66d9076](https://github.com/stanrc85/tuck/commit/66d9076571333704de3ac64486b4cf468c98b569))
* **roadmap:** address review comments on naming and technical accuracy ([7c35f90](https://github.com/stanrc85/tuck/commit/7c35f908edbae086e0fc1384f02ca85d9c5d0d4e))
* **security:** address command injection and path traversal vulnerabilities ([cceb04d](https://github.com/stanrc85/tuck/commit/cceb04ddcfe5d6ad8ac3dee91b639878a1b02893))
* show command-specific help instead of full help for subcommands ([24f5656](https://github.com/stanrc85/tuck/commit/24f5656e23a78a553c12ca318dc875b8eb2be2e5))
* simplify bin directory detection logic ([5c94a3f](https://github.com/stanrc85/tuck/commit/5c94a3f36144781f6a082da58c0f1947e4c34409))
* simplify heredoc in workflow to avoid YAML parsing issues ([4b12553](https://github.com/stanrc85/tuck/commit/4b12553b6593dc3a7d1cedf402d2c392f86496b8))
* update contributing docs to use development branch workflow ([4a92886](https://github.com/stanrc85/tuck/commit/4a92886cb6c8e4055ee62730c9887769132778e3))
* update tests to match corrected diff behavior ([90f74f3](https://github.com/stanrc85/tuck/commit/90f74f3ea8c100c8fda8684c70d8bf2a734aaee8))
* use !== 1 for pluralization in status messages ([8bd62c3](https://github.com/stanrc85/tuck/commit/8bd62c34fcf1ff3445b9a58b7e698ea444ad5902))
* use generic Git URL validation for manual remote entry ([0a7024a](https://github.com/stanrc85/tuck/commit/0a7024a0536e41e2a78bc57596691727d73f1e12))
* use node18 target for pkg binary builds ([ea0ce16](https://github.com/stanrc85/tuck/commit/ea0ce161994978fc99d43ee38ec8f558b79b50bb))
* use RELEASE_TOKEN for semantic-release to bypass branch protection ([92eb20b](https://github.com/stanrc85/tuck/commit/92eb20b3df9cc7d71407e833bdfe660079c832f6))
* validate backup directory path safety in getBackupDir() ([34bcb7f](https://github.com/stanrc85/tuck/commit/34bcb7faa09a143c394a216984fb4b17b5fe1504))
* validate source paths in importExistingRepo to prevent path traversal ([b8e5d26](https://github.com/stanrc85/tuck/commit/b8e5d2633ca56a2accfa65831489e3c59c4ed06e))


### Features

* add alternative GitHub authentication methods ([77b1174](https://github.com/stanrc85/tuck/commit/77b117456cbdee35bb8513deb58da99f742daf9f))
* add auto-update checking with interactive prompt ([67f1dcd](https://github.com/stanrc85/tuck/commit/67f1dcdd02c09fe0faf8b9c417233a55619d16c4))
* add automatic Homebrew tap update on release ([63ef055](https://github.com/stanrc85/tuck/commit/63ef055030fd04962cefa9777a5a8dba9d82a6f8))
* add comprehensive secrets management with security hardening ([7811465](https://github.com/stanrc85/tuck/commit/7811465fd9b54079cd92438501e8b703c04bd62b))
* add large file detection and .tuckignore support ([dc4784d](https://github.com/stanrc85/tuck/commit/dc4784de823b6fa175e3cf38bbbc95adc4fa923e))
* add multi-provider support with provider abstraction layer ([44381c1](https://github.com/stanrc85/tuck/commit/44381c1f95862440ddaa06f853a5e2f457818ddb))
* add scan command for automatic dotfile detection ([d3e50a9](https://github.com/stanrc85/tuck/commit/d3e50a996876a2a0fb267e701dd22266a9760921))
* add secrets scanning and management ([dcb4ad4](https://github.com/stanrc85/tuck/commit/dcb4ad44b8bc1ad35d4c4ae44e450e02c77f0b54))
* add security hardening, audit logging, and comprehensive testing ([a2939f2](https://github.com/stanrc85/tuck/commit/a2939f2316faffbd12c3abdd01881e1f92145de4))
* add tuck doctor command and expand command smoke coverage ([518462b](https://github.com/stanrc85/tuck/commit/518462b903cda96b6a4880e27a2bcf8d2ac458c6))
* add tuck ignore command for managing .tuckignore ([f267f88](https://github.com/stanrc85/tuck/commit/f267f88e6b14063a09e4670b9bda3454d6005df3))
* add Windows compatibility support ([42e8fb0](https://github.com/stanrc85/tuck/commit/42e8fb00b7628a77e98c6e2e06da8335d5b5ec53))
* comprehensive CLI improvements and test infrastructure ([31ec82f](https://github.com/stanrc85/tuck/commit/31ec82f65de84d80c6641da16415e1bc5a49e55e))
* enhance diff command with binary support and filtering ([d57c407](https://github.com/stanrc85/tuck/commit/d57c407acaa3fd5bdaea0be6bd8f520c6e04f05f))
* enhance secret management with auto-restore and configurable blocking ([01c1816](https://github.com/stanrc85/tuck/commit/01c181699d24c6ab94ce6c99fc8b6d1f75dbc34f))
* implement v1.1.0 features - apply command, Time Machine backups, GitHub auto-setup ([84f5a70](https://github.com/stanrc85/tuck/commit/84f5a707db44c34344747833c1b943f97debf6e4))
* improve onboarding experience with beautiful progress display ([aac84e8](https://github.com/stanrc85/tuck/commit/aac84e8083a770e59657bec43ebc9d1c8e534c28))
* **init:** auto-detect existing GitHub dotfiles repository ([423d9a6](https://github.com/stanrc85/tuck/commit/423d9a66ff67d81f3c6e73702e08f65486d22304))
* initial implementation of tuck dotfiles manager ([c621bfd](https://github.com/stanrc85/tuck/commit/c621bfde7ad77a82a7eea452603ef95342a46449))
* **manifest:** add host groups and required migration ([896ab27](https://github.com/stanrc85/tuck/commit/896ab2750956f6028bb1fdb073f4daa0116beff3))
* **remove:** add --push flag for one-shot untrack+delete+commit+push ([f3537f7](https://github.com/stanrc85/tuck/commit/f3537f7c933c3dc15a5367615e03b2916f12b02f))


### BREAKING CHANGES

* **manifest:** Manifest format bumped from 1.0.0 to 2.0.0. Existing
installs must run `tuck migrate` before any other command will work — every
tracked file now requires at least one host-group, and pre-existing manifests
throw MigrationRequiredError until tagged. `tuck migrate` handles this in
one step (interactive or `-g <name>` non-interactive); the migration is
idempotent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

# [1.9.0](https://github.com/Pranav-Karra-3301/tuck/compare/v1.8.0...v1.9.0) (2026-02-20)


### Bug Fixes

* close remaining naming and credential safety gaps ([670e5d5](https://github.com/Pranav-Karra-3301/tuck/commit/670e5d5c0f2ffade52de09ede97bb514322ef3e6))
* enforce safe destination paths and harden test isolation ([11c167f](https://github.com/Pranav-Karra-3301/tuck/commit/11c167fdd28462d80ee7fc49aab4bff9757fd14d))
* harden manifest path validation and add doctor plan ([75d822a](https://github.com/Pranav-Karra-3301/tuck/commit/75d822a0d2a648c7454b35bdb262aae15123be4c))
* harden tracking pipeline and security safeguards ([289990b](https://github.com/Pranav-Karra-3301/tuck/commit/289990bf0c2c408ee51a438c95e66f1f22dc3f7f))
* improve doctor home and tuck directory checks ([62b9ba0](https://github.com/Pranav-Karra-3301/tuck/commit/62b9ba052fc689a20c47c5364a32cbca81b799c6))
* validate backup directory path safety in getBackupDir() ([34bcb7f](https://github.com/Pranav-Karra-3301/tuck/commit/34bcb7faa09a143c394a216984fb4b17b5fe1504))


### Features

* add tuck doctor command and expand command smoke coverage ([518462b](https://github.com/Pranav-Karra-3301/tuck/commit/518462b903cda96b6a4880e27a2bcf8d2ac458c6))

# [1.8.0](https://github.com/Pranav-Karra-3301/tuck/compare/v1.7.0...v1.8.0) (2026-02-01)


### Bug Fixes

* add longer timeouts for git tests on Windows CI ([a63a439](https://github.com/Pranav-Karra-3301/tuck/commit/a63a439eecabe063a55d0bb2860526377977454a))
* address additional Copilot code review feedback ([7a8dc65](https://github.com/Pranav-Karra-3301/tuck/commit/7a8dc65b27a77fe5224fe2d50f08bcc300b90ce3))
* address code review feedback ([7b4393b](https://github.com/Pranav-Karra-3301/tuck/commit/7b4393b48a986f4d5c56b661583067b2a4dfe4c0))
* address code review issues for password manager integration ([9929af0](https://github.com/Pranav-Karra-3301/tuck/commit/9929af0e510b9ded5db8dac208c55e81144de739))
* address comprehensive code review findings ([cbc37ac](https://github.com/Pranav-Karra-3301/tuck/commit/cbc37ac33e7a0feb3475e44341096df49a20bac1))
* comprehensive bug fixes and expanded test coverage ([e81c31f](https://github.com/Pranav-Karra-3301/tuck/commit/e81c31f2aaa358588d11be86821630c2c39c2ce7))
* correct Homebrew tap name in README ([4807b47](https://github.com/Pranav-Karra-3301/tuck/commit/4807b47f3aab42cd9325ea06aacbb09980dc6ec3)), closes [#74](https://github.com/Pranav-Karra-3301/tuck/issues/74)
* make tests cross-platform for Windows CI ([88c7ae6](https://github.com/Pranav-Karra-3301/tuck/commit/88c7ae6513b0ae24423ad54f410e5d5f49935cdf))
* remove unused variables and imports from test files ([7bc2543](https://github.com/Pranav-Karra-3301/tuck/commit/7bc25438231f928fb1eb858fdf468377147b614c))
* resolve lint errors and remove remotion/video files ([968a290](https://github.com/Pranav-Karra-3301/tuck/commit/968a2902b8dac0d4a2a33ff1b5e4808fd703bad5))
* resolve Windows test failures in paths.test.ts ([85ac358](https://github.com/Pranav-Karra-3301/tuck/commit/85ac3583f14917966970cf151615522ee30e2aa4))
* resolve Windows test failures in paths.test.ts ([f103c67](https://github.com/Pranav-Karra-3301/tuck/commit/f103c676cde62a1e0e529c7b4506670969dd9686))
* use !== 1 for pluralization in status messages ([8bd62c3](https://github.com/Pranav-Karra-3301/tuck/commit/8bd62c34fcf1ff3445b9a58b7e698ea444ad5902))


### Features

* add security hardening, audit logging, and comprehensive testing ([a2939f2](https://github.com/Pranav-Karra-3301/tuck/commit/a2939f2316faffbd12c3abdd01881e1f92145de4))
* add Windows compatibility support ([42e8fb0](https://github.com/Pranav-Karra-3301/tuck/commit/42e8fb00b7628a77e98c6e2e06da8335d5b5ec53))
* enhance secret management with auto-restore and configurable blocking ([01c1816](https://github.com/Pranav-Karra-3301/tuck/commit/01c181699d24c6ab94ce6c99fc8b6d1f75dbc34f))

# [1.7.0](https://github.com/Pranav-Karra-3301/tuck/compare/v1.6.0...v1.7.0) (2026-01-18)


### Bug Fixes

* implement security hardening and code quality improvements ([58df03a](https://github.com/Pranav-Karra-3301/tuck/commit/58df03a6fdf9e1a7e3fb9c6b524d02b033a3c938))
* resolve ESLint warnings in validation utilities ([fbbc76a](https://github.com/Pranav-Karra-3301/tuck/commit/fbbc76a01acb4f753d97885f4cc194a6af16276c))
* restore provider parameter in validateRepoName ([66d9076](https://github.com/Pranav-Karra-3301/tuck/commit/66d9076571333704de3ac64486b4cf468c98b569))


### Features

* add multi-provider support with provider abstraction layer ([44381c1](https://github.com/Pranav-Karra-3301/tuck/commit/44381c1f95862440ddaa06f853a5e2f457818ddb))

# [1.6.0](https://github.com/Pranav-Karra-3301/tuck/compare/v1.5.2...v1.6.0) (2026-01-14)


### Features

* add auto-update checking with interactive prompt ([67f1dcd](https://github.com/Pranav-Karra-3301/tuck/commit/67f1dcdd02c09fe0faf8b9c417233a55619d16c4))

## [1.5.2](https://github.com/Pranav-Karra-3301/tuck/compare/v1.5.1...v1.5.2) (2026-01-14)


### Bug Fixes

* show command-specific help instead of full help for subcommands ([24f5656](https://github.com/Pranav-Karra-3301/tuck/commit/24f5656e23a78a553c12ca318dc875b8eb2be2e5))

## [1.5.1](https://github.com/Pranav-Karra-3301/tuck/compare/v1.5.0...v1.5.1) (2026-01-13)


### Bug Fixes

* resolve diff command issues from PR review ([3d298fc](https://github.com/Pranav-Karra-3301/tuck/commit/3d298fcc73dd5be23b43f24015615e8a12c5a3c9))
* update tests to match corrected diff behavior ([90f74f3](https://github.com/Pranav-Karra-3301/tuck/commit/90f74f3ea8c100c8fda8684c70d8bf2a734aaee8))

# [1.5.0](https://github.com/Pranav-Karra-3301/tuck/compare/v1.4.1...v1.5.0) (2026-01-13)


### Bug Fixes

* add colors export to diff.test.ts mock ([7a4b4f2](https://github.com/Pranav-Karra-3301/tuck/commit/7a4b4f27a26fba84432dd07d320c2854b5d108b4))
* address code review issues ([15834d0](https://github.com/Pranav-Karra-3301/tuck/commit/15834d0775ff8d270994262e26feaac5818b04cc))


### Features

* enhance diff command with binary support and filtering ([d57c407](https://github.com/Pranav-Karra-3301/tuck/commit/d57c407acaa3fd5bdaea0be6bd8f520c6e04f05f))

## [1.4.1](https://github.com/Pranav-Karra-3301/tuck/compare/v1.4.0...v1.4.1) (2026-01-13)


### Bug Fixes

* correct glob pattern regex escaping for skip patterns ([60d48c0](https://github.com/Pranav-Karra-3301/tuck/commit/60d48c0b65364250f59edd2f960271cf151b7240))

# [1.4.0](https://github.com/Pranav-Karra-3301/tuck/compare/v1.3.0...v1.4.0) (2026-01-10)


### Bug Fixes

* add workflow_dispatch trigger to CI workflow ([b3f6976](https://github.com/Pranav-Karra-3301/tuck/commit/b3f69766ee2586f61f8c902a4b13106c20b75e4b))
* address code review comments (simple fixes) ([6f47f34](https://github.com/Pranav-Karra-3301/tuck/commit/6f47f34294bb61d86936abb963ec9d25db329065))
* address code review feedback from PR[#29](https://github.com/Pranav-Karra-3301/tuck/issues/29) ([c615ef0](https://github.com/Pranav-Karra-3301/tuck/commit/c615ef05475773ddedb60570ceb235e694254d5e))
* address complex code review comments ([322d071](https://github.com/Pranav-Karra-3301/tuck/commit/322d071d040f7a332afe07a8438b915c5f98acf7))
* address PR review comments - improve code quality, security, and type safety ([c1f1fdd](https://github.com/Pranav-Karra-3301/tuck/commit/c1f1fdd2c4d83edbf8ea6892bebe47ac19ed854a))
* address PR review comments - improve security docs, error messages, and code quality ([29bf6f3](https://github.com/Pranav-Karra-3301/tuck/commit/29bf6f3e3d338f897413ccb91d44e45806d456d8))
* address PR review comments - improve security, error messages, and validation ([e37a54d](https://github.com/Pranav-Karra-3301/tuck/commit/e37a54d48cc3eba7219c6d41ab7a2624b5186d37))
* address PR review comments - improve URL validation and token format ([dce5794](https://github.com/Pranav-Karra-3301/tuck/commit/dce579470e1e4909c75d02a95e8a890936b5a582))
* address PR review comments - security, type safety, and code quality improvements ([cf4ae39](https://github.com/Pranav-Karra-3301/tuck/commit/cf4ae392a61b9ccdc574fd4b85218f8efd833f82))
* address PR review comments and critical issues ([89c7c30](https://github.com/Pranav-Karra-3301/tuck/commit/89c7c30b28d575312517df4b5d62f671bab8ed94))
* address PR review feedback on secrets management ([ae945e9](https://github.com/Pranav-Karra-3301/tuck/commit/ae945e90ac1511d01b2618a4418631732f594d93))
* correct comment inaccuracies from code review ([b29e60c](https://github.com/Pranav-Karra-3301/tuck/commit/b29e60c3d3b2ceb88baf4a3fd332f5eb14965909))
* correct regex escaping and simplify success message logic ([79b4e83](https://github.com/Pranav-Karra-3301/tuck/commit/79b4e836026c8ec311c7614e8ff1dab10f93b03b))
* extract GITHUB_TOKEN_PREFIXES constant and improve fallback logic ([232377c](https://github.com/Pranav-Karra-3301/tuck/commit/232377c5f65e1c8e284944a9deda505e433de503))
* extract MIN_GITHUB_TOKEN_LENGTH constant and restore username fallback ([7fd6c63](https://github.com/Pranav-Karra-3301/tuck/commit/7fd6c63cb9d481dbb49735847ce49ac9060d455f))
* **github:** add blank line terminator to git credential protocol input ([ba65ec7](https://github.com/Pranav-Karra-3301/tuck/commit/ba65ec78fe4642d4ab9508d5f6cd07d02f53396f))
* **github:** properly narrow token type in updateStoredCredentials ([17b3750](https://github.com/Pranav-Karra-3301/tuck/commit/17b3750b59de334db448e9c1af7a695c794cc4bd))
* implement --since option for scan-history command ([7ee42a7](https://github.com/Pranav-Karra-3301/tuck/commit/7ee42a7d93410894e9a1ca9ff7f733ca9f693025))
* improve init flow with better GitHub error handling and file pre-selection ([250823f](https://github.com/Pranav-Karra-3301/tuck/commit/250823f478172d7932ae50e016fde0db4beb4e90))
* improve known_hosts parsing and clarify GitHub URL validation context ([b242381](https://github.com/Pranav-Karra-3301/tuck/commit/b24238100b7ac705169ef25110f8192192043cf6))
* improve known_hosts parsing to prevent hostname confusion ([fcd8577](https://github.com/Pranav-Karra-3301/tuck/commit/fcd8577757b0c0b24ee3dc816659c49f5cacee93))
* improve URL validation and username fallback logic ([dc95131](https://github.com/Pranav-Karra-3301/tuck/commit/dc951317038dda5753e9e349ad885972d7895726))
* improve URL validation regex and known_hosts parsing logic ([8c7e5b5](https://github.com/Pranav-Karra-3301/tuck/commit/8c7e5b577fc0e65110ba19790b8f2e51c082e56a))
* **init:** handle case where only sensitive files are detected ([3622302](https://github.com/Pranav-Karra-3301/tuck/commit/362230297772aa05be1ac8700484f1effaeb65b9))
* make addFilesFromPaths throw error on secrets detection ([d837c37](https://github.com/Pranav-Karra-3301/tuck/commit/d837c3792b67a415b31b6499e1d52ed6ed315569))
* prevent duplicate secret storage when same value matched by multiple patterns ([8ea5870](https://github.com/Pranav-Karra-3301/tuck/commit/8ea5870c85f2f1149b96552ab6e7a917cfef2112))
* remove redundant undefined and clarify GITHUB_TOKEN_PREFIXES usage ([29bf7d9](https://github.com/Pranav-Karra-3301/tuck/commit/29bf7d9d012ab34a347b07be726ad94718f1f630))
* remove unused imports and variables (lint errors) ([aca6079](https://github.com/Pranav-Karra-3301/tuck/commit/aca60797d3e936609cd7917e3e38caf15444d902))
* reset regex lastIndex in hasPlaceholders to prevent state pollution ([98cf7c8](https://github.com/Pranav-Karra-3301/tuck/commit/98cf7c8cffe31c75ebdff736467179050cdeb898))
* simplify bin directory detection logic ([5c94a3f](https://github.com/Pranav-Karra-3301/tuck/commit/5c94a3f36144781f6a082da58c0f1947e4c34409))
* update contributing docs to use development branch workflow ([4a92886](https://github.com/Pranav-Karra-3301/tuck/commit/4a92886cb6c8e4055ee62730c9887769132778e3))
* use generic Git URL validation for manual remote entry ([0a7024a](https://github.com/Pranav-Karra-3301/tuck/commit/0a7024a0536e41e2a78bc57596691727d73f1e12))
* use RELEASE_TOKEN for semantic-release to bypass branch protection ([92eb20b](https://github.com/Pranav-Karra-3301/tuck/commit/92eb20b3df9cc7d71407e833bdfe660079c832f6))


### Features

* add alternative GitHub authentication methods ([77b1174](https://github.com/Pranav-Karra-3301/tuck/commit/77b117456cbdee35bb8513deb58da99f742daf9f))
* add comprehensive secrets management with security hardening ([7811465](https://github.com/Pranav-Karra-3301/tuck/commit/7811465fd9b54079cd92438501e8b703c04bd62b))
* add large file detection and .tuckignore support ([dc4784d](https://github.com/Pranav-Karra-3301/tuck/commit/dc4784de823b6fa175e3cf38bbbc95adc4fa923e))
* add secrets scanning and management ([dcb4ad4](https://github.com/Pranav-Karra-3301/tuck/commit/dcb4ad44b8bc1ad35d4c4ae44e450e02c77f0b54))
* comprehensive CLI improvements and test infrastructure ([31ec82f](https://github.com/Pranav-Karra-3301/tuck/commit/31ec82f65de84d80c6641da16415e1bc5a49e55e))

# [1.3.0](https://github.com/Pranav-Karra-3301/tuck/compare/v1.2.1...v1.3.0) (2025-12-27)


### Bug Fixes

* prevent shell injection in migration documentation examples ([5247088](https://github.com/Pranav-Karra-3301/tuck/commit/5247088267652f4768ab6323ecfcc942820eb5fa))
* resolve multiple logic gaps and safety issues ([4980175](https://github.com/Pranav-Karra-3301/tuck/commit/498017592423b141c25e7b3e0ab91170dbabf82d))
* resolve undefined variable and type errors in progress tracking ([e3fd023](https://github.com/Pranav-Karra-3301/tuck/commit/e3fd02341518f290c0ba04ac93a321386faa2db1))
* **roadmap:** address review comments on naming and technical accuracy ([7c35f90](https://github.com/Pranav-Karra-3301/tuck/commit/7c35f908edbae086e0fc1384f02ca85d9c5d0d4e))


### Features

* improve onboarding experience with beautiful progress display ([aac84e8](https://github.com/Pranav-Karra-3301/tuck/commit/aac84e8083a770e59657bec43ebc9d1c8e534c28))

## [1.2.1](https://github.com/Pranav-Karra-3301/tuck/compare/v1.2.0...v1.2.1) (2025-12-27)


### Bug Fixes

* correct dry_run boolean comparison in release workflow ([48a6d8a](https://github.com/Pranav-Karra-3301/tuck/commit/48a6d8a13b4d6e29df5e5ee6d107c9a0e65b58d4))
* multiple bug fixes and UX improvements ([6f8e01d](https://github.com/Pranav-Karra-3301/tuck/commit/6f8e01d56644a16c429473364b7f5b11ab9985b1))

# Changelog

## [1.2.0](https://github.com/Pranav-Karra-3301/tuck/compare/v1.1.1...v1.2.0) (2025-12-27)


### Bug Fixes

* **init:** validate destination paths and copy plain-dotfiles repo contents ([8f61bca](https://github.com/Pranav-Karra-3301/tuck/commit/8f61bca849cc8f7e10cf918d1b7bf7ab267c7ce8))
* preserve existing .gitignore and README.md in plain-dotfiles import ([d32dd96](https://github.com/Pranav-Karra-3301/tuck/commit/d32dd96bc8657ecf9175384a2a44d25fec52e121))
* validate source paths in importExistingRepo to prevent path traversal ([b8e5d26](https://github.com/Pranav-Karra-3301/tuck/commit/b8e5d2633ca56a2accfa65831489e3c59c4ed06e))


### Features

* **init:** auto-detect existing GitHub dotfiles repository ([423d9a6](https://github.com/Pranav-Karra-3301/tuck/commit/423d9a66ff67d81f3c6e73702e08f65486d22304))

## [1.1.1](https://github.com/Pranav-Karra-3301/tuck/compare/v1.1.0...v1.1.1) (2025-12-27)


### Bug Fixes

* use node18 target for pkg binary builds ([ea0ce16](https://github.com/Pranav-Karra-3301/tuck/commit/ea0ce161994978fc99d43ee38ec8f558b79b50bb))

# [1.1.0](https://github.com/Pranav-Karra-3301/tuck/compare/v1.0.0...v1.1.0) (2025-12-27)


### Bug Fixes

* **add:** correct sensitive file pattern matching for paths with ~/ prefix ([af4372f](https://github.com/Pranav-Karra-3301/tuck/commit/af4372f24af2b85e66230eef5e392e93f0ad6de8))
* check stderr for GitHub CLI authentication status ([1219c0b](https://github.com/Pranav-Karra-3301/tuck/commit/1219c0bf207b18cb3a3e37e1dedba144eb4b1899))
* correct SSH/GPG permission checks in restore command ([9814283](https://github.com/Pranav-Karra-3301/tuck/commit/9814283e75d7202d3217410ff95b9857219e813b))
* prevent backup filename collisions in Time Machine snapshots ([5e3a1de](https://github.com/Pranav-Karra-3301/tuck/commit/5e3a1de48cfe38b78e517ea525fad2015ef99277))
* **security:** address command injection and path traversal vulnerabilities ([cceb04d](https://github.com/Pranav-Karra-3301/tuck/commit/cceb04ddcfe5d6ad8ac3dee91b639878a1b02893))


### Features

* add scan command for automatic dotfile detection ([d3e50a9](https://github.com/Pranav-Karra-3301/tuck/commit/d3e50a996876a2a0fb267e701dd22266a9760921))
* implement v1.1.0 features - apply command, Time Machine backups, GitHub auto-setup ([84f5a70](https://github.com/Pranav-Karra-3301/tuck/commit/84f5a707db44c34344747833c1b943f97debf6e4))

# 1.0.0 (2025-12-27)


### Bug Fixes

* add missing semantic-release plugins and install script ([b5663c6](https://github.com/Pranav-Karra-3301/tuck/commit/b5663c60e6a6d200f4868f26f4c8a23583eaac13))
* correct inputs.dry_run check for push events ([d91771f](https://github.com/Pranav-Karra-3301/tuck/commit/d91771fc451866053ce5cd0a3cf4c4ed1d76271f))
* handle dry-run mode correctly in version detection logic ([b776007](https://github.com/Pranav-Karra-3301/tuck/commit/b776007648da8aa384bd6f81c7d734bd8ce55598))
* resolve ESLint errors in table.ts ([c158c4c](https://github.com/Pranav-Karra-3301/tuck/commit/c158c4c6adff5bac73ae5ef9a6bffe873b2d3e09))
* resolve npm publish permission error and fix release pipeline ([2c69c9b](https://github.com/Pranav-Karra-3301/tuck/commit/2c69c9b4df31c90827623867db7610a35a7255e9))
* simplify heredoc in workflow to avoid YAML parsing issues ([4b12553](https://github.com/Pranav-Karra-3301/tuck/commit/4b12553b6593dc3a7d1cedf402d2c392f86496b8))


### Features

* add automatic Homebrew tap update on release ([63ef055](https://github.com/Pranav-Karra-3301/tuck/commit/63ef055030fd04962cefa9777a5a8dba9d82a6f8))
* initial implementation of tuck dotfiles manager ([c621bfd](https://github.com/Pranav-Karra-3301/tuck/commit/c621bfde7ad77a82a7eea452603ef95342a46449))

# 0.1.0 (2025-12-27)


### Bug Fixes

* add missing semantic-release plugins and install script ([b5663c6](https://github.com/Pranav-Karra-3301/tuck/commit/b5663c60e6a6d200f4868f26f4c8a23583eaac13))
* resolve ESLint errors in table.ts ([c158c4c](https://github.com/Pranav-Karra-3301/tuck/commit/c158c4c6adff5bac73ae5ef9a6bffe873b2d3e09))


### Features

* add automatic Homebrew tap update on release ([63ef055](https://github.com/Pranav-Karra-3301/tuck/commit/63ef055030fd04962cefa9777a5a8dba9d82a6f8))
* initial implementation of tuck dotfiles manager ([c621bfd](https://github.com/Pranav-Karra-3301/tuck/commit/c621bfde7ad77a82a7eea452603ef95342a46449))
