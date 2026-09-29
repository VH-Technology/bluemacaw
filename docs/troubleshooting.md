# Troubleshooting

> **This doc is a Plan D deliverable.** A full symptom-keyed punch list for the Tauri-era app lands in Plan D (Section 13 of the release-pipeline plan). Until then, use the pointers below.

Closest equivalents for common issues:

- **macOS permission issues** (Microphone / Accessibility / Input Monitoring prompts not showing, stale denials) — see [`permissions.md`](./permissions.md) and the `/reset-perms` slash command.
- **Provider HTTP failures** (401, 429, network) — check the relevant provider's docs URL inside `packages/desktop/src/providers/<provider>.ts`; deprecated model ids are aliased automatically (see `assemblyai.ts` and `groq.ts`).
- **Packaged-build smoke test** — `/diagnose` (read-only).
- **Hotkey doesn't fire** — on macOS, Input Monitoring must be granted for the Fn-key tap; for standard combos, check Accessibility is granted (paste step). See [`permissions.md`](./permissions.md).
- **Onboarding screen keeps appearing** — `bluemacaw-onboarding.bin` in the app's data dir tracks the completed flag; deleting it resets onboarding.
- **macOS types `v` instead of pasting** — older builds used shared modifier state, which could lose synthetic Command during physical mouse/key input. The macOS sender now uses an isolated event source and explicit Command flags. Increasing the clipboard delay does not address this problem. If it persists, run the [native paste probe](./testing.md#macos-native-paste-probe) and report the receiving app, keyboard layout, hotkey, and captured event flags.
