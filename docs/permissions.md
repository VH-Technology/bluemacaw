# Permissions

bluemacaw needs up to three privacy grants on platforms that gate them:

- **Microphone** — to record audio. Gated on macOS (TCC) and Windows.
- **Accessibility** — to inject the synthetic `Cmd+V` / `Ctrl+V` paste keystroke. Gated on macOS only; Windows allows `SendInput` without a per-app grant.
- **Input Monitoring** — only when the user picks the macOS Fn key as their hotkey. Gates `CGEventTap`, which is a distinct TCC bucket from Accessibility (`kTCCServiceListenEvent` vs `kTCCServiceAccessibility`).

Per-platform implementations live under `packages/desktop/src-tauri/src/audio/permissions/`. The webview never speaks to the OS directly — it calls the Tauri commands `check_*_permission`, `request_*_permission`, and `open_settings_panel`.

## macOS

### Microphone

**Granted via:** TCC, prompted on first call to `AVCaptureDevice.requestAccess(forMediaType:)`.

Required pieces:

1. **Entitlement** — `com.apple.security.device.audio-input` signed into the bundle. Source: `packages/desktop/src-tauri/entitlements.plist`. Wired via `tauri.conf.json` → `bundle.macOS.entitlements`. Tauri's bundler propagates the entitlement to nested binaries during `tauri build`; no `codesign --deep` re-sign step is needed (unlike Electron).
2. **Usage description** — `NSMicrophoneUsageDescription` in `packages/desktop/src-tauri/Info.plist`, wired via `tauri.conf.json` → `bundle.macOS.infoPlist`. Without this string macOS rejects the request without showing a prompt.
3. **Runtime trigger** — the webview calls `vox.requestMicrophonePermission()`. The recording controller deliberately gates on permission *before* cpal opens an input stream (see `recording-controller.ts`), because cpal's implicit prompt path is unreliable on production-signed bundles.

### Accessibility (paste keystroke)

**Granted via:** TCC, prompted on first attempt to post a synthetic keyboard event via `CGEventPost`.

- **Runtime trigger** — `audio::permissions::macos::request_accessibility_permission` calls `AXIsProcessTrustedWithOptions` with `kAXTrustedCheckOptionPrompt: true`. macOS opens System Settings → Privacy & Security → Accessibility; the user must flip the toggle.
- **Why:** the paste step uses `enigo` which lowers to `CGEventPost`. macOS gates synthetic event injection on Accessibility.
- **Bundle scope:** per `tauri.conf.json` `identifier`, i.e. `com.vhtechnology.bluemacaw`.
- **Polling vs. prompting:** `check_accessibility_permission` (non-prompting) is what the onboarding poll uses every second; `check_accessibility_permission_prompting` (rate-limited prompt) is what the explicit "Grant Accessibility" button calls.

### Input Monitoring (Fn-key hotkey)

**Granted via:** TCC, prompted on first attempt to install a `CGEventTap`.

- **Runtime trigger** — only when the user picks `HotkeyCombo::Fn` in Settings → Recording. `MacOsFnTap::register` installs the tap; if Input Monitoring is missing, the manager surfaces `ShortcutError::InputMonitoringRequired` and the UI prompts the user to grant.
- **Usage description** — `NSInputMonitoringUsageDescription` in `Info.plist`. Required for macOS to show the request dialog.
- **TCC propagation gotcha:** macOS only re-reads Input Monitoring grants on process launch. After the user grants, bluemacaw must restart — hence the `restart_app` Tauri command exposed to the webview.

### Apple Events (optional)

`NSAppleEventsUsageDescription` is present in `Info.plist` because bluemacaw may use Apple Events to refocus the previously-focused app before pasting. No runtime code requests this today; the string is staged for that hardening.

## Windows

### Microphone

Windows 10/11 gates microphone access via the privacy settings UI (`Settings → Privacy → Microphone`).

- `audio::permissions::windows::check_microphone_permission` reads the registry under `HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone` and surfaces a coarse `Granted` / `Denied` / `NotDetermined`.
- `request_microphone_permission` opens the Privacy panel via `ms-settings:privacy-microphone` (handled by `open_settings_panel`); there is no Win32 prompt API.

### Accessibility / Input Monitoring

Not gated. The Windows variants of `check_accessibility_permission` and `check_input_monitoring_permission` return `Granted`. Windows allows synthetic key injection via `SendInput` without a per-app grant.

## Dev mode vs packaged build (macOS)

`bun run tauri:dev` runs bluemacaw from your terminal in debug mode. macOS Microphone, Accessibility, and Input Monitoring grants are inherited from the parent process — i.e. from your terminal application (Terminal.app, iTerm, Ghostty, etc.). If the terminal already has those grants, dev-mode bluemacaw just works without prompting. **This means a dev build is not a fair test of the packaged permission flow.**

A packaged build (`/Applications/bluemacaw.app`) has its own bundle id (`com.vhtechnology.bluemacaw`) and asks TCC for its own grants. Always test permission-related changes against the packaged build via `/build-clean`.

Windows does not have this dev-mode shortcut; the privacy panels see the binary path, not the parent process.

## Resetting (macOS)

If prompts no longer appear, TCC has cached a decision. Reset with:

```bash
tccutil reset Microphone com.vhtechnology.bluemacaw
tccutil reset Accessibility com.vhtechnology.bluemacaw
tccutil reset ListenEvent com.vhtechnology.bluemacaw
```

Or run `/reset-perms`. Then relaunch bluemacaw.

## Spec cross-references

- Plan B §6.3 — Per-platform microphone permission flow.
- Plan B §6.10 — Accessibility for paste.
- Recording-settings-and-history plan §2 — Input Monitoring as a separate TCC bucket; Fn-key tap flow.
