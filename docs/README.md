# bluemacaw Documentation

Long-form docs for bluemacaw. Most of these are written across Plans B and D as the relevant subsystems land.

## Architecture & internals

- [`architecture.md`](./architecture.md) — Process model, Tauri command surface, recording flow sequence diagram.
- [`testing.md`](./testing.md) — 4-layer testability architecture, mocking boundaries, audio fixtures.
- [`permissions.md`](./permissions.md) — Microphone, Accessibility, and Input Monitoring grants per platform.
- [`secrets.md`](./secrets.md) — Per-platform credential storage and threat model.
- [`providers.md`](./providers.md) — How to add a new STT provider.

## Build, release, deploy

- [`build-and-release.md`](./build-and-release.md) — Local build, signing, notarization, release workflow walkthrough. **Plan D — placeholder.**
- [`ci-cd.md`](./ci-cd.md) — GitHub Actions overview, branch protection, OIDC, secrets list. **Plan D — not yet written.**

## Operations & dev workflow

- [`troubleshooting.md`](./troubleshooting.md) — Symptom-keyed punch list. **Plan D — placeholder.**
- [`development-workflow.md`](./development-workflow.md) — When to use which slash command.

## Per-package READMEs

- [`../packages/desktop/README.md`](../packages/desktop/README.md) — Tauri app specifics.
- [`../packages/landing/README.md`](../packages/landing/README.md) — Next.js landing specifics.
- [`../packages/infra/README.md`](../packages/infra/README.md) — Pulumi IaC specifics (AWS + Cloudflare DNS). **Plan D — not yet written.**
