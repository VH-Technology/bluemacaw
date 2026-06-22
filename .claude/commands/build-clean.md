---
description: Full clean build & install ritual for bluemacaw (Tauri). Resets TCC on macOS, rebuilds, copies the bundle.
---

Run the cross-platform clean-build ritual for bluemacaw. The full rationale lives in `docs/build-and-release.md` (written in Plan D); this command is the operational entry point.

bluemacaw uses Tauri 2 (not Electron). The bundle identifier is `com.vhtechnology.bluemacaw`. The packaged app name is `bluemacaw`.

## Preflight

Confirm the working directory is the bluemacaw repo root:

```bash
test -f packages/desktop/src-tauri/tauri.conf.json && \
  test -f packages/desktop/package.json
```

If either check fails, abort with: "Not in the bluemacaw repo root. Refusing to run destructive build steps."

Detect the host OS via `uname -s` and dispatch.

## macOS

### Confirm with the user

Print the steps that are about to run and ask for confirmation before any destructive op:

1. `tccutil reset Microphone com.vhtechnology.bluemacaw`
2. `tccutil reset Accessibility com.vhtechnology.bluemacaw`
3. `tccutil reset ListenEvent com.vhtechnology.bluemacaw`
4. `tccutil reset AppleEvents com.vhtechnology.bluemacaw`
5. `rm -rf "/Applications/bluemacaw.app" packages/desktop/src-tauri/target/release/bundle/`
6. `cd packages/desktop && bun run tauri:build`
7. `cp -R "packages/desktop/src-tauri/target/release/bundle/macos/bluemacaw.app" "/Applications/bluemacaw.app"`

Ask: "This will delete `/Applications/bluemacaw.app` and the Tauri release bundle output. Proceed?" Wait for confirmation.

### Run the ritual

Halt on the first non-zero exit and report which step failed.

```bash
# 1-4: Reset TCC. tccutil exits non-zero when no entry exists; treat that as success.
tccutil reset Microphone com.vhtechnology.bluemacaw || true
tccutil reset Accessibility com.vhtechnology.bluemacaw || true
tccutil reset ListenEvent com.vhtechnology.bluemacaw || true
tccutil reset AppleEvents com.vhtechnology.bluemacaw || true

# 5: Remove the previous install + bundle output.
rm -rf "/Applications/bluemacaw.app" packages/desktop/src-tauri/target/release/bundle/

# 6: Build (signed via the configured signing identity if set; otherwise ad-hoc).
cd packages/desktop && bun run tauri:build

# 7: Install.
cp -R "src-tauri/target/release/bundle/macos/bluemacaw.app" "/Applications/bluemacaw.app"
```

### Verify

Unlike the Electron-era Ada, **Tauri does not require a manual `--deep` re-sign step**. Tauri's bundler propagates entitlements correctly into nested binaries during `tauri build`. To confirm the entitlement landed:

```bash
codesign -d --entitlements - "/Applications/bluemacaw.app" 2>&1 | grep 'com.apple.security.device.audio-input'
```

If the grep finds nothing, `entitlements.plist` was not picked up — check `tauri.conf.json` `bundle.macOS.entitlements`.

## Windows

```powershell
cd packages\desktop
bun run tauri:build
Start-Process "src-tauri\target\release\bundle\msi\bluemacaw_*_x64_en-US.msi"
```

## After install

Launch bluemacaw. macOS will prompt for Microphone, then later (when the global shortcut fires for the first time) for Accessibility — plus Input Monitoring the first time the user picks the Fn key as their shortcut. Approve them as they appear. If no prompts appear, run `/reset-perms` and relaunch — a previous denial may be cached.

For symptom-keyed troubleshooting, see `docs/troubleshooting.md` (Plan D).
