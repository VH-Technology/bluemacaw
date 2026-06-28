---
name: reset-onboarding
description: Use when resetting local bluemacaw onboarding so the first-run wizard appears again for manual UI testing
---

# Reset onboarding

Use this when you need to make bluemacaw show onboarding again on the local machine, especially while testing onboarding UI changes.

## What state controls onboarding

- Completion flag: `bluemacaw-onboarding.bin` in the Tauri app data dir.
- Windows app data dir: `%APPDATA%\com.vhtechnology.bluemacaw`.
- Store key inside that file: `onboarding_v2_completed`.
- App database: `bluemacaw.db` in the same app data dir.
- The gate silently skips onboarding if permissions, hotkeys, API keys, and model configs are already satisfied.

Because of the silent-skip path, deleting only `bluemacaw-onboarding.bin` may not be enough. For visual onboarding testing, remove API keys and model configs too.

## Safe reset for onboarding UI testing

Close bluemacaw first. Then run:

```powershell
$dir = "$env:APPDATA\com.vhtechnology.bluemacaw"
$db = Join-Path $dir "bluemacaw.db"
$store = Join-Path $dir "bluemacaw-onboarding.bin"

if (!(Test-Path -LiteralPath $dir)) {
    throw "App data directory not found: $dir"
}

if (Test-Path -LiteralPath $db) {
    sqlite3 $db "PRAGMA foreign_keys=ON; DELETE FROM model_configs; DELETE FROM api_keys; DELETE FROM app_state WHERE key='active_model_config_id';"
}

if (Test-Path -LiteralPath $store) {
    Remove-Item -LiteralPath $store
}
```

Verify:

```powershell
$dir = "$env:APPDATA\com.vhtechnology.bluemacaw"
$db = Join-Path $dir "bluemacaw.db"
$store = Join-Path $dir "bluemacaw-onboarding.bin"

"onboarding_store_exists=$(Test-Path -LiteralPath $store)"
if (Test-Path -LiteralPath $db) {
    sqlite3 $db "SELECT 'api_keys=' || COUNT(*) FROM api_keys; SELECT 'model_configs=' || COUNT(*) FROM model_configs;"
}
```

Expected output:

```text
onboarding_store_exists=False
api_keys=0
model_configs=0
```

Relaunch bluemacaw. The onboarding wizard should appear.

## More destructive full reset

Only use this if you explicitly want to move all local app data, including history and settings, out of the way:

```powershell
Rename-Item -LiteralPath "$env:APPDATA\com.vhtechnology.bluemacaw" -NewName "com.vhtechnology.bluemacaw.backup-onboarding-ui"
```

Restore after testing:

```powershell
Remove-Item -LiteralPath "$env:APPDATA\com.vhtechnology.bluemacaw" -Recurse -Force
Rename-Item -LiteralPath "$env:APPDATA\com.vhtechnology.bluemacaw.backup-onboarding-ui" -NewName "com.vhtechnology.bluemacaw"
```

## Notes

- Do not delete secrets directly from the OS keychain for this UI reset. Removing `api_keys` rows is enough to make onboarding miss the API-key prerequisite.
- If `sqlite3` is not installed, use the full app-data move instead or install SQLite tooling locally.
