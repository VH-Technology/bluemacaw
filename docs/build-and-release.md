# Build & Release

> **This doc is a Plan D deliverable.** The full local-build + signing + notarization + release-pipeline walkthrough lands in Plan D.

Until then:

- **Local clean build & install (macOS):** `/build-clean` slash command (defined in `.claude/commands/build-clean.md`). Runs `tauri build`, copies the bundle into `/Applications/bluemacaw.app`, performs a TCC reset so a fresh permission flow can be exercised.
- **Dev loop:** `/dev-desktop` (Vite + cargo watch).
- **CI release workflow:** `.github/workflows/release.yml`. Currently builds the macOS bundle on tag pushes; Linux and Windows targets are temporarily disabled (see commit `99c5b37`).

The Plan D rewrite of this doc will cover:

- Apple Developer ID signing + notarytool stapling.
- Linux GPG-signed deb / rpm + self-hosted apt / dnf repository metadata.
- S3 + CloudFront publication and CloudFront invalidation.
- GitHub Releases artifact upload via OIDC.

## Auto-updater

bluemacaw ships with `tauri-plugin-updater`. Every release publishes a Tauri-shaped `update.json` manifest as a GitHub release asset; the running app polls it on startup, downloads the appropriate per-platform bundle if a newer version is available, verifies it against the embedded minisign public key, and offers an in-app "Install & restart" banner.

### Three JSON assets, three consumers

The release workflow publishes **three** JSON files that look superficially similar but serve different consumers:

| File             | Consumer                          | Schema                                                                     |
| ---------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `latest.json`    | Landing page download buttons     | `{ version, mac, win, linux, linuxArm64 }` — bare URLs to installers.      |
| `update.json`    | `tauri-plugin-updater` in-app     | `{ version, pub_date, notes, platforms.<key>.{signature, url} }`.          |
| `changelog.json` | Landing changelog page (fallback) | `Release[]` — `{ tag, name, body, publishedAt, htmlUrl }` per release.     |

All three are emitted from `.github/workflows/release.yml`. Keep them separate — fusing them would couple the landing page deploy to the updater contract.

`changelog.json` is a **fallback** for the changelog page. That page (`packages/landing/src/app/changelog/page.tsx` → `lib/github.ts`) fetches the live GitHub Releases API at build time; if that fails (rate limit on a shared CI-runner IP, private repo, network), `fetchReleases` falls back to `https://github.com/<repo>/releases/latest/download/changelog.json`. That CDN redirect isn't subject to the 60 req/hr unauthenticated API limit, so it resolves when the JSON API 403s. Generated in the `publish-manifest` job via `gh api .../releases`.

### Key management

The updater verifies downloaded bundles against a **minisign** public key that's compiled into the app via `tauri.conf.json` (`plugins.updater.pubkey`). The matching private key signs the updater bundles at CI time.

```sh
# One-time keypair generation (do not re-run unless rotating).
bunx @tauri-apps/cli signer generate -w ~/.tauri/bluemacaw.key
chmod 600 ~/.tauri/bluemacaw.key
```

Then store the signing material in GitHub Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/bluemacaw.key`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the passphrase set during generation.

The password is also archived locally at `~/apps/creds/blue-macaw/minisign-password.txt` (mode 600).

The public key is committed in plaintext in `packages/desktop/src-tauri/tauri.conf.json`. Updating the value requires shipping a release with the new pubkey before retiring the old one — users on stale versions verify against whatever they originally installed.

### Signing in CI

The `release.yml` build step exports `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to `tauri-apps/tauri-action`. When both are set, the bundler emits updater bundles (`.app.tar.gz`, `.AppImage.tar.gz`, `.msi.zip`, `.nsis.zip`) and matching `*.sig` files alongside the user-facing installers. Both sets are uploaded to the GitHub release.

### Building `update.json`

The `publish-update-manifest` job in `release.yml` reads the `.sig` file contents and assembles the manifest below. The endpoint baked into `tauri.conf.json` is `https://github.com/VH-Technology/bluemacaw/releases/latest/download/update.json`, which GitHub redirects to the asset on the most recently published release.

```json
{
  "version": "0.1.3",
  "pub_date": "2026-05-16T21:30:00Z",
  "notes": "See release notes at https://github.com/VH-Technology/bluemacaw/releases/tag/v0.1.3",
  "platforms": {
    "darwin-aarch64":  { "signature": "untrusted comment: …", "url": "https://github.com/VH-Technology/bluemacaw/releases/download/v0.1.3/bluemacaw_0.1.3_universal.app.tar.gz" },
    "darwin-x86_64":   { "signature": "untrusted comment: …", "url": "https://github.com/VH-Technology/bluemacaw/releases/download/v0.1.3/bluemacaw_0.1.3_universal.app.tar.gz" },
    "darwin-universal": { "signature": "untrusted comment: …", "url": "https://github.com/VH-Technology/bluemacaw/releases/download/v0.1.3/bluemacaw_0.1.3_universal.app.tar.gz" },
    "linux-x86_64":    { "signature": "untrusted comment: …", "url": "https://github.com/VH-Technology/bluemacaw/releases/download/v0.1.3/bluemacaw_0.1.3_amd64.AppImage.tar.gz" },
    "linux-aarch64":   { "signature": "untrusted comment: …", "url": "https://github.com/VH-Technology/bluemacaw/releases/download/v0.1.3/bluemacaw_0.1.3_aarch64.AppImage.tar.gz" },
    "windows-x86_64":  { "signature": "untrusted comment: …", "url": "https://github.com/VH-Technology/bluemacaw/releases/download/v0.1.3/bluemacaw_0.1.3_x64-setup.nsis.zip" }
  }
}
```

macOS ships a single universal binary listed under all three `darwin-*` keys so plugin versions that don't recognize `darwin-universal` still resolve a download.

### In-app UX

The frontend lives in `packages/desktop/src/hooks/useUpdater.ts` and `packages/desktop/src/windows/main/UpdateBanner.tsx`. On main-window mount the app calls `check()`; if an update is available, a banner appears at the top of the window with "Install & restart". Clicking it streams the bundle (with progress) and then calls the existing `restart_app` Tauri command.

`check()` retries with exponential backoff (5 attempts: ~1s/2s/4s/8s ≈ 15s total) before giving up — this rides out the cold-boot window where the network isn't up yet when the app launches at login. The status stays "checking" across retries. A failure after all retries surfaces as a transient, auto-dismissing error **toast** (not a persistent banner), and is also reflected in the Settings → Updates "Last check failed: …" line. The user can trigger a manual check from Settings → Updates at any time.

The relaunch path uses `AppHandle::restart()` directly rather than `@tauri-apps/plugin-process` — see `packages/desktop/src-tauri/src/commands.rs::restart_app`.

### Rotating the minisign key

1. Generate a new keypair and store both new secrets (replacing the existing GH secrets is fine — they're write-only).
2. Update `pubkey` in `tauri.conf.json` to the new public key.
3. Ship a release. This release is signed with the **new** key; users on the previous version will reject it because it's signed with a key they don't trust.

Because of step 3, **key rotation requires a manual installer path for affected users**: post the DMG/MSI/AppImage link in release notes and accept that users will re-onboard via the user-facing installers, not the in-app updater.

### Troubleshooting

| Symptom                                                   | Likely cause                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| App reports "signature error" after a release             | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` had a trailing newline or didn't match the key passphrase.    |
| App reports 404 on update check                           | The `update.json` asset failed to upload (check the `publish-update-manifest` job logs).            |
| Updater never offers an update despite a newer release    | `tauri.conf.json` `version` field on the running build is `>=` the manifest `version`.             |
| In-app install hangs at 0%                                | Bundle URL in `update.json` is wrong — re-run the manifest job after fixing the asset name.        |
| Update installs but app doesn't relaunch on Linux         | Some AppImage launchers don't re-exec cleanly. User must restart manually; this is upstream.       |

For architecture, see [`architecture.md`](./architecture.md). For macOS permissions wired into the bundle, see [`permissions.md`](./permissions.md).
