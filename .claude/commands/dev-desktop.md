---
description: Start the bluemacaw Tauri desktop dev server (vite + cargo watch).
---

Start the Tauri 2 desktop app in dev mode. Run from the repo root:

```bash
cd packages/desktop && bun run tauri:dev
```

Expected behavior:

- Vite dev server starts on http://localhost:1420.
- Tauri compiles the Rust binary in debug mode (first build is slow — 30–90s; incremental builds are seconds).
- Two webviews open per `tauri.conf.json`: the main window (`label: "main"`) and the overlay (`label: "overlay"`, transparent + always-on-top).
- Hot reload works for the React/TS side. Saving Rust files triggers a cargo recompile and an app restart.

Do not background the process — the user wants stdout/stderr live and stops the app with Ctrl+C.

## Preflight

Before running, sanity-check the workspace:

```bash
test -f packages/desktop/src-tauri/tauri.conf.json
test -f packages/desktop/package.json
```

If either is missing, abort with: "Not in the bluemacaw repo root, or `packages/desktop` is missing."

## When something goes wrong

- **`tauri-plugin-*` build errors** — run `bun install --frozen-lockfile` from the repo root; the JS plugin packages may be out of sync.
- **macOS: "command not found: tauri"** — the dev dependency `@tauri-apps/cli` lives in `packages/desktop/node_modules`; make sure you ran `bun install` and that you `cd packages/desktop` first.
- **Microphone / Accessibility prompts don't appear** — this is dev mode; permissions are inherited from the parent terminal. See `docs/permissions.md`.
