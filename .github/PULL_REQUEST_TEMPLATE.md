## Summary

<!-- 1-3 bullets describing what changed and why -->

## Test plan

- [ ] Unit tests added/updated and passing
- [ ] Integration tests added/updated and passing (where applicable)
- [ ] Manual smoke test (describe what you exercised)

## Documentation update obligations (per CONTRIBUTING.md trigger table)

Did this PR trigger any of the following? If yes, the relevant docs are updated in this PR.

- [ ] New STT provider → `docs/providers.md`, provider grid in landing, `pricing` entries
- [ ] New model added → provider adapter `defaultModels` + `pricing.lastUpdated`
- [ ] Provider rate change → `pricing.lastUpdated`
- [ ] New Tauri command → `docs/architecture.md`
- [ ] New slash command → `docs/development-workflow.md`, root `CLAUDE.md`
- [ ] New platform → `docs/permissions.md`, `docs/build-and-release.md`, `docs/ci-cd.md`
- [ ] SQLite schema migration → `docs/architecture.md`
- [ ] Signing/release pipeline change → `docs/build-and-release.md`, `docs/ci-cd.md`
- [ ] Threat model change → `docs/secrets.md`, `packages/landing/src/app/privacy/page.tsx`
- [ ] New GitHub Secret → `docs/build-and-release.md`, `docs/ci-cd.md`
- [ ] None of the above applies to this PR

## Breaking changes

<!-- Mark with `BREAKING CHANGE:` in the commit body if so. Otherwise: "None". -->
