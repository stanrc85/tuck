# UI Output Conventions

Rules for terminal output styling across `src/commands/*` and any code that prints to the user.

The goal: every command should look like the same tool. Same gutter, same color logic, same shape.

---

## The two-logger problem

This codebase has two logging surfaces. **Mixing them is the primary source of visual drift.**

| Surface | Source | Behavior |
|---|---|---|
| `logger.*` | `src/ui/logger.ts` (raw `console.log` + `logSymbols`) | Sits **outside** the `@clack/prompts` vertical-bar tree. Symbol is colored, message text is plain white. |
| `prompts.log.*` | `src/ui/prompts.ts` (wraps `@clack/prompts` `p.log.*`) | Attaches to the clack tree. Each line gets the `│` gutter prefix and the appropriate gutter symbol. |

Inside an active `prompts.intro` … `prompts.outro` frame, `logger.*` lines float free of the gutter — exactly the "colored symbol, white text" inconsistency users see.

Precedent fixes for this exact shape: `b34eacd` (v2.22.3, bootstrap-restore) and `864c3fc` (v2.26.1, cheatsheet). `cheatsheet.ts` is the reference implementation — match its shape.

---

## The rules

### 1. Always frame in `prompts.intro` / `prompts.outro`

Every user-facing command opens with `prompts.intro(<title>)` and closes with either `prompts.outro(<punchline>)` or `prompts.cancel(<reason>)`. The intro/outro is the visual frame; without it, output floats as standalone text and the tool feels two-faced.

```typescript
// GOOD
prompts.intro('tuck doctor');
// … work …
prompts.outro(`${formatCount(passed, 'check')} passed`);

// BAD — no frame, raw output to terminal
logger.info('Running diagnostics…');
```

The only exceptions: `--format json` programmatic paths (no frame, no decoration — just emit the JSON), fatal errors that fire before intro could run, and `--help` / `--version` adjacent text.

### 2. Inside the frame, only `prompts.log.*` — never `logger.*`, never raw `console.log`

This is the load-bearing rule. Once `prompts.intro` has fired, every line until `prompts.outro` must go through `prompts.log.success | .info | .warning | .error | .step | .message`. Otherwise you break the gutter.

```typescript
// GOOD
prompts.log.success('Wrote 102 entries across 3 sources');
prompts.log.message(c.dim('  • zsh: 62 entries\n  • yazi: 4 entries'));

// BAD — bypasses clack, line floats outside the tree
logger.success('Wrote 102 entries…');
console.log(c.dim('  • zsh: 62 entries'));
```

Multi-line dim breakdowns: collapse N `console.log` calls into a single `prompts.log.message(c.dim(lines.join('\n')))`. One tree block instead of N stuttery ones.

### 3. `logger.*` is for outside-the-frame contexts only

`logger.*` is fine for: pre-intro fatal errors, programmatic output paths (where decoration would corrupt parseable output), help text, version banners. Never call `logger.*` between `prompts.intro` and `prompts.outro`.

### 4. Color by token, not by line

`c.X(...)` wraps the meaningful token, not the entire line. The gutter symbol from `prompts.log.*` already carries the line's status color; wrapping the whole line on top of that is redundant and visually noisy.

| Token type | Wrap with | Example |
|---|---|---|
| File path | `c.brand` (cyan) | `prompts.log.message(`tracking ${c.brand(path)}`)` |
| Count / number | `c.bold` on the digits | `prompts.log.success(`Wrote ${c.bold(n)} entries`)` |
| Label / metadata | `c.muted` or `c.dim` | `prompts.log.message(c.dim('Last sync: 04.27.2026'))` |
| Status keyword | semantic — `c.success`, `c.warning`, `c.error` | `${c.warning('modified')} ${path}` |
| Whole line | only `prompts.outro(...)` (clack auto-greens it) and explicit section headers | — |

Exception: secondary descriptive lines that are entirely metadata (e.g., the breakdown block) can be wrapped wholesale in `c.dim` because the whole line is metadata.

### 5. No manual tree drawing

Don't render `├──` / `└──` / `│` characters by hand. `@clack/prompts` owns the tree; manual tree drawing duplicates the visual structure and inevitably misaligns. Use `prompts.log.message` for tree-style sub-lines, or `prompts.note(content, title)` for boxed groupings.

### 6. No bare `prompts.outro('')`

Every outro carries a punchline: a path, a count, a next step. Empty outros leave a stranded `└` close. If there's truly nothing to say, the command is misframed — reconsider whether intro/outro is appropriate (see rule 1's exceptions).

```typescript
// GOOD
prompts.outro(`→ ${collapsePath(outputPath)}`);

// BAD
prompts.outro('');
prompts.outro('Done!');  // ← filler word, no information
```

---

## Quick reference

| Situation | Use |
|---|---|
| Open a command flow | `prompts.intro(title)` |
| Close a command flow | `prompts.outro(punchline)` or `prompts.cancel(reason)` |
| Success line inside frame | `prompts.log.success(msg)` |
| Info line inside frame | `prompts.log.info(msg)` or `prompts.log.message(msg)` |
| Warning inside frame | `prompts.log.warning(msg)` |
| Error inside frame | `prompts.log.error(msg)` |
| Step in a sequence | `prompts.log.step(msg)` |
| Dim secondary line | `prompts.log.message(c.dim(msg))` |
| Group of related lines | `prompts.note(body, title)` |
| Spinner for async work | `const s = prompts.spinner(); s.start(...); s.stop(...);` |
| `--format json` output | raw `console.log(JSON.stringify(...))` — no decoration |
| Pre-intro fatal error | `logger.error(msg)` then `process.exit(1)` |

---

## Verifying the rendered output

Type-checking and tests verify code, not visuals. For UI changes, build and run the actual binary:

```bash
pnpm build
node dist/index.js <command>
```

Inspect that:
- Every line between intro and outro is prefixed by the `│` gutter (or is itself the intro/outro/note border)
- Symbols and accent colors agree with the line's intent
- No bare `└` close at the end

---

## When in doubt

`src/commands/cheatsheet.ts` is the model. If a new command doesn't match its shape, fix the new command — not the model.
