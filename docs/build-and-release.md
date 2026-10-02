# Build & Release

> **This doc is a Plan D deliverable.** The full local-build + signing + notarization + release-pipeline walkthrough lands in Plan D.

Until then:

- **Local clean build & install (macOS):** `/build-clean` slash command (defined in `.claude/commands/build-clean.md`). Runs `tauri build`, copies the bundle into `/Applications/bluemacaw.app`, performs a TCC reset so a fresh permission flow can be exercised.
- **Dev loop:** `/dev-desktop` (Vite + cargo watch).
- **CI release workflow:** `.github/workflows/release.yml`. Currently builds the macOS and Windows bundles on tag pushes.
- **macOS deployment target:** 10.15, set by `bundle.macOS.minimumSystemVersion` in `tauri.conf.json`. Tauri propagates this to `MACOSX_DEPLOYMENT_TARGET`; `whisper-rs`/`ggml` requires 10.15 for C++ `std::filesystem`.
- **Apple Intelligence sidecar (macOS):** `build.rs` compiles `swift/apple-intelligence/main.swift` with `xcrun swiftc` into `binaries/bluemacaw-apple-intelligence-<target-triple>` (plus a `-universal-apple-darwin` copy for universal builds). `tauri.macos.conf.json` bundles it via `bundle.externalBin`, and the bundler signs it with the app. `binaries/` is generated and git-ignored. The on-device model needs the `FoundationModels` framework from **Xcode 26 or newer**. With an older SDK the sidecar compiles to a stub, the build prints a cargo warning, and the app hides the On-device cleanup engine. Set `BLUEMACAW_REQUIRE_FOUNDATION_MODELS=1` to make that a hard build error; `release.yml` does this so a release can't ship the stub, and builds macOS on `macos-26` for that reason.

The Plan D rewrite of this doc will cover:

- Apple Developer ID signing + notarytool stapling.
- S3 + CloudFront publication and CloudFront invalidation.
- GitHub Releases artifact upload via OIDC.

## Auto-updater

bluemacaw ships with `tauri-plugin-updater`. Every release publishes a Tauri-shaped `update.json` manifest as a GitHub release asset; the running app polls it on startup, downloads the appropriate per-platform bundle if a newer version is available, verifies it against the embedded minisign public key, and offers an in-app "Install & restart" banner.

### Three JSON assets, three consumers

The release workflow publishes **three** JSON files that look superficially similar but serve different consumers:

| File             | Consumer                          | Schema                                                                     |
| ---------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `latest.json`    | Landing page download buttons     | `{ version, mac, win }` — bare URLs to installers.      |
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

The `release.yml` build step exports `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to `tauri-apps/tauri-action`. When both are set, the bundler emits updater bundles (`.app.tar.gz`, `.msi.zip`, `.nsis.zip`) and matching `*.sig` files alongside the user-facing installers. Both sets are uploaded to the GitHub release.

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

Because of step 3, **key rotation requires a manual installer path for affected users**: post the DMG/MSI link in release notes and accept that users will re-onboard via the user-facing installers, not the in-app updater.

### Troubleshooting

| Symptom                                                   | Likely cause                                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| App reports "signature error" after a release             | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` had a trailing newline or didn't match the key passphrase.    |
| App reports 404 on update check                           | The `update.json` asset failed to upload (check the `publish-update-manifest` job logs).            |
| Updater never offers an update despite a newer release    | `tauri.conf.json` `version` field on the running build is `>=` the manifest `version`.             |
| In-app install hangs at 0%                                | Bundle URL in `update.json` is wrong — re-run the manifest job after fixing the asset name.        |
| macOS build reports `std::filesystem` APIs unavailable    | The deployment target fell below 10.15; check `bundle.macOS.minimumSystemVersion`.                  |
| macOS build fails with "no FoundationModels framework"  | `BLUEMACAW_REQUIRE_FOUNDATION_MODELS=1` is set and the active Xcode is older than 26; select Xcode 26+ (`sudo xcode-select -s …`). |
| Homebrew still offers the previous version after a release | `publish-homebrew` job failed — check the tap credential (`HOMEBREW_TAP_DEPLOY_KEY` or `HOMEBREW_TAP_TOKEN`), then bump by hand ([Homebrew tap](#homebrew-tap)). |

## Homebrew tap

macOS users can install with Homebrew instead of the DMG:

```sh
brew install --cask vh-technology/tap/bluemacaw
```

The cask lives in [`VH-Technology/homebrew-tap`](https://github.com/VH-Technology/homebrew-tap) at `Casks/bluemacaw.rb`. It points at the universal DMG of a GitHub release and pins its SHA-256, so Homebrew installs the exact signed + notarized bundle the release job produced.

Two stanzas matter because the app also updates itself with `tauri-plugin-updater`:

- `auto_updates true` — on `brew upgrade`, Homebrew compares the cask version with the installed app's `CFBundleShortVersionString` and skips the reinstall when the in-app updater already brought the app to the current version. Either update path ends in the same state.
- `uninstall quit: "com.vhtechnology.bluemacaw"` — Homebrew quits the app before replacing or removing the bundle.

### Tap trust

Since Homebrew 6.0.0, non-official taps need explicit trust on each user's machine ([Tap Trust](https://docs.brew.sh/Tap-Trust)). A tap cannot pre-trust itself; only `homebrew/core` and `homebrew/cask` are trusted by default.

Installing by the fully-qualified name trusts that one cask as part of the install, so every install instruction must use `vh-technology/tap/bluemacaw` — never `brew tap vh-technology/tap` followed by the short name. A user who tapped first sees "The following taps are not trusted" in `brew doctor` and fixes it with:

```sh
brew trust --cask vh-technology/tap/bluemacaw
```

Dropping the trust step entirely (`brew install --cask bluemacaw`) requires the cask to be accepted into the official `homebrew/cask` tap, which audits the GitHub repo for notability: any one of 225 stars, 90 forks or 90 watchers for a self-submission (75 / 30 / 30 when a third party submits), and a repo at least 30 days old.

### Automatic bump on release

The `publish-homebrew` job in `release.yml` runs after the build matrix on every published, non-prerelease release. It downloads `bluemacaw_<version>_universal.dmg` from the release, computes its SHA-256, rewrites the `version` and `sha256` lines in the cask, and pushes the commit to the tap's `main`. Re-running it for a release the tap already has is a no-op.

The default `GITHUB_TOKEN` cannot push to another repository, so the job needs **one** of these two Actions secrets on the bluemacaw repo. It prefers the deploy key when both exist.

**Option A — write-enabled deploy key** (`HOMEBREW_TAP_DEPLOY_KEY`). Scoped to the single tap repo and needs no personal account. The VH-Technology org currently has deploy keys **disabled** by policy (GitHub returns "Deploy keys are disabled for this repository"); an org owner can enable them under Organization settings → Member privileges → Deploy keys, after which:

```sh
ssh-keygen -t ed25519 -N "" -C "bluemacaw release.yml -> homebrew-tap" -f /tmp/homebrew-tap-deploy
gh repo deploy-key add /tmp/homebrew-tap-deploy.pub --allow-write --title "bluemacaw release.yml" --repo VH-Technology/homebrew-tap
gh secret set HOMEBREW_TAP_DEPLOY_KEY --repo VH-Technology/bluemacaw < /tmp/homebrew-tap-deploy
rm /tmp/homebrew-tap-deploy /tmp/homebrew-tap-deploy.pub
```

**Option B — fine-grained personal access token** (`HOMEBREW_TAP_TOKEN`). Create it at GitHub → Settings → Developer settings → Fine-grained tokens with resource owner **VH-Technology**, repository access limited to **homebrew-tap**, and the single permission **Contents: Read and write**. Then:

```sh
gh secret set HOMEBREW_TAP_TOKEN --repo VH-Technology/bluemacaw
```

Fine-grained tokens expire (one year max), so put a reminder on the expiry date. To rotate either credential, store the new value under the same secret name and delete the old key or token.

### Manual bump

If the job fails (revoked key, renamed asset), bump by hand in a clone of the tap:

```sh
curl -fsSLO https://github.com/VH-Technology/bluemacaw/releases/download/v1.2.3/bluemacaw_1.2.3_universal.dmg
shasum -a 256 bluemacaw_1.2.3_universal.dmg
# edit the version + sha256 lines in Casks/bluemacaw.rb, then:
brew style vh-technology/tap
brew audit --cask --online vh-technology/tap/bluemacaw
```

### Graduating to homebrew-cask

Once the repo clears Homebrew's notability bar for the main `homebrew-cask` tap, submit the same cask there at `Casks/b/bluemacaw.rb`. After it merges, delete the cask from this tap so the two never disagree, and switch the release job to `brew bump-cask-pr`.

For architecture, see [`architecture.md`](./architecture.md). For macOS permissions wired into the bundle, see [`permissions.md`](./permissions.md).
