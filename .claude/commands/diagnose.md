---
description: Read-only diagnostic for bluemacaw — packaged install, permissions, config sanity.
---

Run the following checks in order. For each, print a single line of the form `✓ <description>` or `✗ <description> — <fix hint>`. Do not modify any state. After all checks, print a one-line summary.

This is the cross-platform successor to the legacy `/diagnose-mic` (Electron-era, macOS-only). It dispatches per platform.

## Platform detection

Detect the host OS once:

```bash
uname -s
```

- `Darwin` → run macOS checks.
- Anything containing `MINGW`/`MSYS`/`CYGWIN` (or run from PowerShell) → Windows checks.

## Common checks (all platforms)

### Workspace sanity

```bash
test -f packages/desktop/src-tauri/tauri.conf.json
test -f packages/desktop/package.json
```

Fix hint: "Not in the bluemacaw repo root."

### Bundle identifier matches

```bash
grep -q '"identifier": "com.vhtechnology.bluemacaw"' packages/desktop/src-tauri/tauri.conf.json
```

Fix hint: "`tauri.conf.json` identifier drift — should be `com.vhtechnology.bluemacaw`."

## macOS

### Microphone entitlement signed in

```bash
test -f packages/desktop/src-tauri/entitlements.plist && \
  grep -q 'com.apple.security.device.audio-input' packages/desktop/src-tauri/entitlements.plist
```

### `Info.plist` declares `NSMicrophoneUsageDescription`

```bash
grep -q 'NSMicrophoneUsageDescription' packages/desktop/src-tauri/Info.plist 2>/dev/null
```

Fix hint: "Add the usage description to `Info.plist`; macOS rejects mic requests without it."

### Installed app present (if `/build-clean` has been run)

```bash
test -d "/Applications/bluemacaw.app"
```

Not an automatic ✗ — print informational "bluemacaw.app not installed (run `/build-clean`)." if absent.

### TCC for `com.vhtechnology.bluemacaw`

Informational only — `tccutil` cannot read state, only reset. Suggest: "System Settings → Privacy & Security → Microphone / Accessibility — confirm `bluemacaw` is enabled."

## Windows

### WebView2 runtime present

Check the registry for the Edge WebView2 runtime client GUID. From PowerShell:

```powershell
Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue
```

Fix hint: "Install Microsoft Edge WebView2 Evergreen Runtime."

## Summary

- All passed: "All checks passed. If transcription still fails, the issue is most likely a missing or invalid API key — open the app, check the Providers tab, and re-enter the key. Or run the app under `bun run tauri:dev` and inspect the console."
- Anything failed: "Failures above. Address them top-to-bottom — workspace and bundle identifier issues block the rest."

This command is read-only. Do not run any commands that modify state (no `tccutil`, no `rm`, no `codesign --force`, no installer commands). Use `/reset-perms` if you need to reset macOS TCC.
