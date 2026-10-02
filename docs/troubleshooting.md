# Troubleshooting

> **This doc is a Plan D deliverable.** A full symptom-keyed punch list for the Tauri-era app lands in Plan D (Section 13 of the release-pipeline plan). Until then, use the pointers below.

Closest equivalents for common issues:

- **macOS permission issues** (Microphone / Accessibility / Input Monitoring prompts not showing, stale denials) — see [`permissions.md`](./permissions.md) and the `/reset-perms` slash command.
- **Provider HTTP failures** (401, 429, network) — check the relevant provider's docs URL inside `packages/desktop/src/providers/<provider>.ts`; deprecated model ids are aliased automatically (see `assemblyai.ts` and `groq.ts`).
- **Packaged-build smoke test** — `/diagnose` (read-only).
- **Hotkey doesn't fire** — on macOS, Input Monitoring must be granted for the Fn-key tap; for standard combos, check Accessibility is granted (paste step). See [`permissions.md`](./permissions.md).
- **Main window doesn't open after logging in** — intended. A launch at login starts in the tray only (macOS: any launch within two minutes of logging in; Windows/Linux: the autostart entry's `--autostart` flag). Open the window from the Dock icon or the tray's "Open bluemacaw". If the window *does* still open at login on macOS, the app started more than two minutes after login — see `login_launch.rs`.
- **Onboarding screen keeps appearing** — `bluemacaw-onboarding.bin` in the app's data dir tracks the completed flag; deleting it resets onboarding.
- **macOS types `v` instead of pasting** — older builds used shared modifier state, which could lose synthetic Command during physical mouse/key input. The macOS sender now uses an isolated event source and explicit Command flags. Increasing the clipboard delay does not address this problem. If it persists, run the [native paste probe](./testing.md#macos-native-paste-probe) and report the receiving app, keyboard layout, hotkey, and captured event flags.
- **No "On-device" option in Settings → Cleanup** — the Apple Intelligence engine is only offered on macOS 27+ on Macs that support Apple Intelligence, and only in builds compiled with Xcode 26+ (older SDKs produce a stub sidecar; see [`build-and-release.md`](./build-and-release.md)). Running `bluemacaw.app/Contents/MacOS/bluemacaw-apple-intelligence status` prints the reason the app sees, e.g. `{"status":"unavailable","reason":"apple-intelligence-not-enabled"}`.
- **On-device cleanup pastes the raw transcript** — cleanup fails open. Common causes: Apple Intelligence was turned off or its model is still downloading (Settings shows a Check again banner), the transcript exceeded the on-device model's context window, or the rewrite took longer than 30 s.
