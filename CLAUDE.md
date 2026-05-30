# CLAUDE.md

AI dev workflow guide for bluemacaw — a cross-platform speech-to-text desktop app, currently migrating from Electron (legacy) to Tauri.

## What bluemacaw is

**bluemacaw** is the new Tauri-based version of what was originally **Ada** (a macOS-only Electron app). The migration is in flight on branch `execution` (branched from `tech-stack` at the start of Plan A; final PR `execution` → `main` lives at the end of Plan D).

- **Display name:** bluemacaw
- **URL slug:** `bluemacaw`
- **Identifier (no hyphens):** `bluemacaw` (used for Cargo crate name and macOS bundle id `com.vhtechnology.bluemacaw`)
- **Domain:** `bluemacaw.com`
- **GitHub repo:** `VH-Technology/bluemacaw`
- **License:** Apache 2.0

## Monorepo layout

```
bluemacaw/
├── packages/
│   ├── desktop/    # Tauri app: Rust backend + React webview
│   ├── landing/    # Next.js static landing page
│   └── infra/      # Pulumi IaC: AWS + Cloudflare DNS
├── docs/             # Long-form documentation
├── .claude/commands/ # Slash commands
├── .github/workflows/ # CI/CD
└── [root tooling: package.json, biome.json, lefthook.yml, commitlint.config.js, tsconfig.base.json]
```

## Workflows

- **Develop desktop app:** `/dev-desktop` (implemented in Plan B)
- **Develop landing page:** `/dev-landing` (implemented in Plan C)
- **Run all tests:** `/test` (Plan B)
- **Pre-push subset:** `/test-fast` (Plan B)
- **Typecheck everything:** `/typecheck` (Plan B/C)
- **Lint everything:** `/lint`
- **Build a clean signed desktop binary locally:** `/build-clean` (Plan B; signing in Plan D)
- **Diagnose desktop app state:** `/diagnose` (Plan B)
- **Macros: reset macOS permissions:** `/reset-perms` (Plan B)
- **Add a new STT provider:** `/add-provider <id>` (Plan B)
- **Audit doc updates needed for current changes:** `/sync-docs`
- **Cut a release:** see [Releasing](#releasing) below.

## Releasing

The version lives in **five** places that must stay in lockstep: `packages/desktop/package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, and `packages/landing/package.json`. The landing UI reads its version from `packages/landing/package.json` (via `src/lib/version.ts`), so no hand-edits there.

Do **not** edit those files by hand. Use the scripts:

```sh
bun run version:check          # verify all five agree (no arg) or equal a given version
bun run version:bump 0.2.0     # bump all five to 0.2.0
```

Full cut (branch + PR per the branching convention, since the release workflow's `verify-versions` gate requires `main` to already match the tag):

```sh
bun run version:bump 0.2.0
git checkout -b chore/bump-v0.2.0
git commit -am "chore: bump version to 0.2.0"
# open PR, let CI pass, merge to main
gh release create v0.2.0 --target main --generate-notes   # publishing fires .github/workflows/release.yml
```

Publishing the GitHub release triggers `release.yml`, which:

1. **`verify-versions`** — fails fast if any of the five manifests ≠ the tag (so a forgotten `version:bump` doesn't burn the build matrix).
2. Builds + signs the macOS / Linux / Windows bundles and attaches them.
3. Publishes three JSON assets: `latest.json` (landing download buttons), `update.json` (in-app `tauri-plugin-updater`, minisign-signed), and `changelog.json` (fallback for the landing changelog page when the live GitHub API is unavailable).

The in-app updater endpoint resolves via the `releases/latest/download/update.json` redirect, so the published release must be marked **Latest** (GitHub does this for the newest published non-prerelease). After a release, sanity-check that the live endpoint serves the new version. Full pipeline detail: [`docs/build-and-release.md`](./docs/build-and-release.md).

## Conventions

- **Branching:** PRs are the expected workflow so CI runs and the diff is reviewable. `main` is not GitHub-protected (deferred until the repo goes public or upgrades to Pro — see `docs/ci-cd.md` for the one-shot enable command). Linear history (rebase merge) is convention, not enforced.
- **Commits:** Conventional Commits 1.0 — enforced via lefthook + commitlint. Allowed types: `feat`, `fix`, `chore`, `docs`, `test`, `build`, `ci`, `refactor`, `perf`, `style`, `revert`
- **Test discipline:** strict TDD. Failing test first, then minimal implementation. Per the spec's 4-layer testability architecture (unit / integration / functional / E2E)
- **Doc discipline:** if a change matches a row in the documentation update trigger table (spec §5.1, mirrored in `CONTRIBUTING.md`), the same PR updates the affected docs
- **Hooks:** pre-commit fast & cosmetic; commit-msg blocks non-conventional; pre-push runs typecheck + lint + tests. CI runs the full matrix.

## Skills (when working on this repo)

bluemacaw references the [Anthropic superpowers skills](https://github.com/anthropics/superpowers) (already available in your environment) PLUS four project-local skills in `.claude/skills/` that document tooling specifics for this codebase. Project-local skills auto-activate when their description matches the task at hand.

**Superpowers (workflow process):**
- `superpowers:brainstorming` — when starting a new feature
- `superpowers:writing-plans` — to break a design into tasks
- `superpowers:subagent-driven-development` — to execute a plan task-by-task
- `superpowers:test-driven-development` — the discipline subagents follow per task

**Project-local (tooling reference):**
- `tauri-2-app-development` — capabilities, plugins, multi-window, macOS Info.plist gotchas
- `pulumi-cloud-iac` — Pulumi Cloud state + secrets, AWS profile, Cloudflare provider
- `tauri-release-and-distribution` — Apple notarization, minisign updater, GPG-signed apt/dnf repos
- `ai-sdk-transcribe` — `experimental_transcribe`, provider factory pattern, MSW v2 mocking

## Documentation index

See [`docs/README.md`](./docs/README.md) for the full doc index. Quick links once they exist:

- [`docs/architecture.md`](./docs/architecture.md) — process model, command surface, sequence diagrams (Plan B)
- [`docs/testing.md`](./docs/testing.md) — the 4-layer architecture and audio fixtures (Plan B)
- [`docs/permissions.md`](./docs/permissions.md) — mic + Accessibility flow per platform (Plan B)
- [`docs/secrets.md`](./docs/secrets.md) — keychain backend per platform, threat model (Plan B)
- [`docs/providers.md`](./docs/providers.md) — how to add an STT provider (Plan B)
- [`docs/build-and-release.md`](./docs/build-and-release.md) — local build + signing + release workflow (Plan D)
- [`docs/install-linux.md`](./docs/install-linux.md) — apt + dnf user install instructions (Plan D)
- [`docs/ci-cd.md`](./docs/ci-cd.md) — GitHub Actions overview, branch protection, OIDC (Plan D)
- [`docs/troubleshooting.md`](./docs/troubleshooting.md) — symptom-keyed punch list (Plan D)
