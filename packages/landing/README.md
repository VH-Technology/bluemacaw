# @bluemacaw/landing

bluemacaw's marketing site — Next.js 15 App Router with static export, Tailwind v3, and a hand-written shadcn/ui-styled component library themed via [neobrutalism.dev](https://www.neobrutalism.dev).

Deployed to S3 + CloudFront under `bluemacaw.com` (production infra lands in Plan D). PR previews land at `/previews/pr-<num>/` once Plan D provisions the bucket.

## Stack

- **Framework:** Next.js 15 (App Router, `output: 'export'` for fully static SSG)
- **Styling:** Tailwind CSS v3 + the shared design tokens (white-navy-blue light, dark-navy dark) sourced from the same CSS variables the desktop uses
- **Components:** Hand-written shadcn primitives (`button`, `card`, `badge`, `separator`) plus page-level sections in `src/components/`. The `src/components/ui/` primitives mirror those used by the desktop app at `packages/desktop/src/components/ui/`.
- **Tests:** Vitest + happy-dom + `@testing-library/react` for unit; Playwright (chromium-only) for E2E
- **Lint/format:** Biome (root config)

## Routes

Three routes — all pre-rendered to static HTML:

| Path | Source | Description |
|---|---|---|
| `/` | `src/app/page.tsx` | Hero → Demo → Features → ProvidersGrid → PrivacyTeaser → Download → Footer |
| `/privacy` | `src/app/privacy/page.tsx` | Threat model, OS keychain story, zero-telemetry promise |
| `/changelog` | `src/app/changelog/page.tsx` | Async server component fetching `https://api.github.com/repos/programow/ada/releases` at build time, renders entries newest first, empty state when no releases yet |

## Commands

Run from this package directory (or via `bun --cwd packages/landing run <cmd>` from repo root):

```bash
bun run dev          # Next.js dev server on http://localhost:3000
bun run build        # Static export to ./out (used by deploy and Playwright)
bun run start        # Serve the production build (rare; prefer the static export)
bun run typecheck    # tsc --noEmit
bun run test         # Same as test:unit
bun run test:unit    # Vitest unit + component tests
bun run test:e2e     # Playwright against the built static export (run `bun run build` first)
```

For the Claude Code dev workflow: `/dev-landing` (defined in `.claude/commands/dev-landing.md`).

## Provider grid

`src/components/providers-grid.tsx` currently **hardcodes** the 9 STT providers shipped at v1 (alphabetical: AssemblyAI, Azure OpenAI, Deepgram, ElevenLabs, Fal, Gladia, Groq, OpenAI, Rev.ai). Logo SVGs at `public/logos/<id>.svg` are placeholders.

When adding or removing a provider:

1. Update the desktop registry at `packages/desktop/src/providers/index.ts` first (the source of truth for the desktop app).
2. Mirror the change in `src/components/providers-grid.tsx` (name, id, logo path).
3. Add or remove the placeholder SVG at `public/logos/<id>.svg`.
4. Update the home-section test in `src/components/home-sections.test.tsx`.
5. Update `docs/providers.md` (per the doc-update obligation table in `CONTRIBUTING.md`).

A v2 enhancement (deferred) is to source the grid directly from the desktop registry; for now the duplication is intentional so the landing build doesn't depend on the desktop package.

## Tests

### Unit (Vitest)

Lives alongside source: `src/components/<x>.test.tsx`, `src/app/<route>/page.test.tsx`, `src/lib/<x>.test.ts`. happy-dom env, `@testing-library/jest-dom/vitest` matchers, `@` aliased to `src`.

### E2E (Playwright)

Three smoke specs at `tests/e2e/{home,privacy,changelog}.spec.ts`. The Playwright config spawns `bunx serve out -p 3000` so you must `bun run build` before `bun run test:e2e` runs.

First-time setup (one-time): `bunx playwright install chromium`. CI installs browsers via `bunx playwright install chromium --with-deps`.

## Deploy

- **PR previews:** `.github/workflows/pr-preview.yml` triggers on PR pushes that touch `packages/landing/**`, builds the static export, and (once Plan D's AWS infra exists) uploads `out/` to `s3://<bucket>/previews/pr-<num>/`. Until then it builds and posts a placeholder preview URL comment.
- **Production:** Plan D's `release.yml` rebuilds the landing on every release tag, syncs `out/` to `s3://bluemacaw-prod/`, and invalidates CloudFront.

Provisioning of the S3 bucket, CloudFront distribution, ACM cert, and Cloudflare DNS records is owned by Plan D (`packages/infra/`).
