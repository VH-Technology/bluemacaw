# Development Workflow

bluemacaw ships project-local Claude Code slash commands under [`.claude/commands/`](../.claude/commands/). They automate the rituals this project would otherwise require you to remember and run by hand.

This doc lists what each command does and when to use it. The commands themselves are the source of truth for *how* — each one is a small markdown file with executable instructions.

## When to use which command

| You're doing… | Run | Why |
|---|---|---|
| Editing TS/Rust, want to see the change | `/dev-desktop` | Vite + Tauri dev server, hot reload for the webview, cargo recompile for the Rust core. |
| Editing the landing site | `/dev-landing` | Next.js dev server on http://localhost:3000. |
| Running the full test suite before pushing | `/test` | Vitest (TS) + `cargo test --lib` (Rust). |
| Iterating on a single TS module — fastest feedback | `/test-fast` | Skips integration + functional + Rust. |
| Type-checking | `/typecheck` | `tsc --noEmit` across all workspaces. |
| Linting + formatting check | `/lint` | `biome check .`. Use `bun run lint:fix` to auto-fix. |
| Coverage report | `/coverage` | Vitest with `@vitest/coverage-v8`. |
| Adding an STT provider | `/add-provider <id> <Name>` | Scaffolds adapter + registry entry + tests + docs. |
| Building + installing the packaged app locally | `/build-clean` | Full Tauri build, installs to `/Applications/bluemacaw.app` on macOS. |
| Diagnosing a packaged-build problem | `/diagnose` | Read-only checks for entitlements, signature, runtime libs. |
| TCC prompts misbehaving on macOS | `/reset-perms` | `tccutil reset` for `com.vhtechnology.bluemacaw`. macOS-only. |
| Auditing doc obligations on the current branch | `/sync-docs` | Walks the trigger table from `CONTRIBUTING.md`. |

## When to bypass the slash commands

You shouldn't normally, but valid cases:

- **Iterating on a single Rust file** without the full Tauri shell: `cd packages/desktop/src-tauri && cargo build` (won't run the app, but compiles fast).
- **Reproducing a specific signing or capability bug:** you may want to run `tauri build` directly with extra `--verbose` flags. `/build-clean` won't let you skip steps.
- **Investigating TCC behavior with a non-bluemacaw bundle id:** `tccutil` by hand, since `/reset-perms` hardcodes `com.vhtechnology.bluemacaw`.

## Adding a new command

Drop a new markdown file in `.claude/commands/<name>.md` with:

```markdown
---
description: One-line summary shown in the slash-command picker.
---

Body of the prompt that Claude executes when the user types /<name>.
Write it as instructions to Claude, not to the user.
```

Claude Code picks it up automatically on the next session.

The trigger table in `CONTRIBUTING.md` calls out new slash commands as a doc-update trigger — update the table above when you add one.
