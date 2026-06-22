# Contributing to bluemacaw

Thanks for your interest. bluemacaw is open source under Apache 2.0.

## Branching & PRs

- PRs are the expected workflow so CI runs and the diff is reviewable. `main` is not GitHub-protected (the repo is private and classic protection requires Pro on private repos; we'll enable protection when the repo goes public — one-shot command documented in `docs/ci-cd.md`).
- Open a PR from a feature branch (e.g., `feat/<short-description>`, `fix/<bug-id>`).
- All CI checks should pass before merging — don't merge red even though nothing technically blocks you yet.
- Linear history: prefer rebase merge over merge commits. Keep your branch up to date with `git fetch origin && git rebase origin/main`.

## Commit messages

[Conventional Commits 1.0](https://www.conventionalcommits.org/) is **enforced** via lefthook + commitlint.

Allowed types: `feat`, `fix`, `chore`, `docs`, `test`, `build`, `ci`, `refactor`, `perf`, `style`, `revert`.

Format: `<type>(<optional scope>): <subject>`

Examples:

- `feat(desktop): add Groq provider adapter`
- `fix(landing): resolve hydration mismatch in changelog page`
- `docs: update permissions doc for new Accessibility flow`
- `ci: add Windows code-signing job`

## Hooks

Lefthook installs hooks automatically on `bun install` (via the `prepare` script). The hooks are:

- **pre-commit:** Biome formats + lints staged TS/JS/JSON files. Fast (<5s).
- **commit-msg:** commitlint blocks non-conventional commit messages.
- **pre-push:** typecheck + lint at root (and tests once packages have them). Target <60s total.

If you need to bypass hooks for a specific reason, ask in the PR — don't `--no-verify` silently.

## Testing discipline

Strict TDD per the writing-plans skill: failing test first, then implementation. Tests are organized in 4 layers (unit / integration / functional / E2E) per `docs/testing.md` (Plan B).

Integration tests mock at the **system boundary**, never inside it (HTTP via MSW v2 + wiremock; OS APIs via trait swaps). See `docs/testing.md`.

## Documentation update obligations

If your PR triggers any of the rows below, the same PR must update the affected docs.

| Trigger | Update these docs |
|---|---|
| New STT provider | `docs/providers.md`, `packages/desktop/README.md`, `packages/landing/src/components/providers-grid.tsx`, the provider's `pricing` field with `lastUpdated` |
| New model added to existing provider | Provider adapter file's `defaultModels` + `pricing` table (with `lastUpdated`) |
| Provider rate change | Provider adapter file's `pricing.lastUpdated` + per-model rate |
| New Tauri command | `docs/architecture.md` (command surface table) |
| New slash command | `docs/development-workflow.md`, root `CLAUDE.md` |
| New target platform | `docs/permissions.md`, `docs/install-<platform>.md`, `docs/build-and-release.md`, `docs/ci-cd.md`, root `README.md` |
| SQLite schema migration | `docs/architecture.md` (history schema section) |
| Signing or release pipeline change | `docs/build-and-release.md`, `docs/ci-cd.md` |
| New audio source / capture mode | `docs/architecture.md` (audio module), `docs/permissions.md` |
| Threat model change | `docs/secrets.md`, `packages/landing/src/app/privacy/page.tsx` |
| New required GitHub Secret | `docs/build-and-release.md`, `docs/ci-cd.md` |

Use `/sync-docs` before opening a PR — it audits your changes against this table and proposes patches.

## Cutting a release

Version strings live in **five** places that all have to agree (npm desktop, npm landing, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`). The landing page Footer reads its version from `packages/landing/package.json` via `src/lib/version.ts`, so the only edits needed are the five manifests.

Use the bump script — it touches all five atomically:

```sh
# Verify everything currently agrees (run anytime):
bun run version:check

# Bump everything to a new version:
bun run version:bump 0.2.0

# Commit, tag, push:
git commit -am "chore: bump version to 0.2.0"
git tag v0.2.0
git push origin main v0.2.0

# Publish the GH release (this triggers .github/workflows/release.yml):
gh release create v0.2.0 --target main --generate-notes
```

The release workflow runs a `verify-versions` gate first that re-checks every manifest against the tag and fails fast if anything is out of sync — so a forgotten bump won't waste 15 runner-minutes producing mismatched artifacts.

## License

By contributing you agree your contributions are licensed under Apache 2.0.
