---
description: Reset macOS Microphone, Accessibility, Input Monitoring, and Apple Events permissions for bluemacaw (com.vhtechnology.bluemacaw). Use when permission prompts no longer appear or to retest the grant flow.
---

Reset the macOS TCC entries for bluemacaw so that Microphone, Accessibility, Input Monitoring, and Apple Events prompts fire again on next launch.

No-op on Windows: that platform surfaces a single OS-level prompt at first use. If invoked on a non-macOS host, print `"Skipping — TCC reset is macOS-only."` and exit.

On macOS, run these four commands sequentially:

```bash
tccutil reset Microphone com.vhtechnology.bluemacaw
tccutil reset Accessibility com.vhtechnology.bluemacaw
tccutil reset ListenEvent com.vhtechnology.bluemacaw
tccutil reset AppleEvents com.vhtechnology.bluemacaw
```

`tccutil` occasionally exits non-zero when the system has never seen a TCC entry for the bundle id — that is harmless; mention it if you see it but do not abort.

After all four succeed, tell the user:

> Permissions reset for Microphone, Accessibility, Input Monitoring, and Apple Events. Relaunch bluemacaw from `/Applications/bluemacaw.app` so macOS re-prompts for Microphone, then later for Accessibility and Input Monitoring (the latter two only fire when the global shortcut is pressed for the first time, with Input Monitoring specifically triggered when the Fn key is selected as the shortcut). Apple Events is declared in `Info.plist` for future paste-flow features and will prompt the first time bluemacaw scripts another app. If no prompts appear, the bundle is missing entitlements — run `/diagnose`.

### Dev-binary stale-entry caveat

Under `cargo tauri dev`, TCC keys the record by the unsigned dev binary path (e.g. `target/debug/bluemacaw`) rather than the bundle id, so `tccutil reset … com.vhtechnology.bluemacaw` does **not** clear those rows — it only clears stale prod-bundle entries. To clear dev-path TCC entries, either run `tccutil reset Microphone` with no bundle id (a global wipe across all apps) or accept that dev grants persist until the binary path moves. The same caveat applies to the other three buckets.
