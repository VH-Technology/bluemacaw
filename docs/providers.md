# Providers

bluemacaw ships ten STT (speech-to-text) providers. The registry is data-driven — every provider is a `ProviderConfig` value, registered exactly once in `packages/desktop/src/providers/index.ts`. There is no provider class, no provider factory, no provider DI container. The whole UI (model picker, pricing display, etc.) reads from the same array.

## Bundled providers

| ID | Name | Default models | Has `listModels` |
|---|---|---|---|
| `assemblyai` | AssemblyAI | `universal-3-pro`, `universal-2` | static |
| `azure-openai` | Azure OpenAI | `whisper` (deployment id) | static |
| `deepgram` | Deepgram | `nova-3`, `nova-2`, `enhanced` | static |
| `elevenlabs` | ElevenLabs | `scribe_v1` | live (`/v1/models`, filtered to `can_do_transcribe`) |
| `fal` | Fal | `whisper`, `wizper` | static |
| `gladia` | Gladia | `whisper-large-v3` | static |
| `groq` | Groq | `whisper-large-v3`, `whisper-large-v3-turbo` | live (`/openai/v1/models`, filtered by `whisper` in id) |
| `openai` | OpenAI | `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` | live (`/v1/models`, filtered to known transcription ids) |
| `revai` | Rev.ai | `machine`, `low_cost`, `fusion` | static |
| `xai` | Grok (xAI) | `grok-stt` | static |

(Authoritative source: `packages/desktop/src/providers/*.ts`.)

> **xAI is the one exception to the `makeModel` rule.** The Vercel AI SDK has
> no xAI transcription adapter, so `xai.ts` implements the optional
> `transcribeBatch(audio, modelId, apiKey)` hook instead — a direct
> `multipart/form-data` POST to `https://api.x.ai/v1/stt` (routed through the
> Tauri HTTP plugin to dodge webview CORS). `lib/transcribe.ts` prefers
> `transcribeBatch` when present and skips `experimental_transcribe`. Its
> `makeModel` throws and is never called.

### Legacy model aliases

A few providers translate retired model ids on the fly so persisted user configs keep working after the provider deprecates a model:

- `assemblyai.ts` aliases `best → universal-3-pro`, `nano → universal-2`. The same file also wraps the AI SDK's `fetch` (`rewritingFetch`) to translate the deprecated `speech_model` (singular) request body field to `speech_models` (plural array) until `@ai-sdk/assemblyai` ships the rename.
- `groq.ts` aliases `distil-whisper-large-v3-en → whisper-large-v3-turbo` (Groq retired the distil model on 2025-08-23).

When removing one of these aliases, delete both the entry in `LEGACY_MODEL_ALIASES` and the corresponding test.

## The `ProviderConfig` contract

Every provider is a value of this type, defined in `packages/desktop/src/providers/types.ts`:

```ts
export interface ProviderConfig {
    id: string;
    name: string;
    logoSrc: string;
    docsUrl: string;
    apiKeyHelpUrl: string;
    pricingDocsUrl: string;
    makeModel: (modelId: string, apiKey: string) => TranscriptionModel;
    listModels: ((apiKey: string) => Promise<Model[]>) | null;
    defaultModels: Model[];
    pricing: Record<string, PricingEntry>;
    validateKey?: (apiKey: string) => Promise<boolean>;
}
```

Field purposes:

- `id` (kebab-case) — the lookup key. Used as the keychain account name (per [Secrets](secrets.md)) and as the React component key.
- `name` (display) — user-visible name. Title case.
- `logoSrc` — path to the SVG (under `packages/landing/public/logos/<id>.svg` for the landing page; the desktop app reuses the same paths).
- `docsUrl` — link surfaced from the Settings tab "What is this provider?".
- `apiKeyHelpUrl` — link surfaced from the Settings tab "Where do I get a key?".
- `pricingDocsUrl` — link surfaced next to the per-minute pricing column.
- `makeModel(modelId, apiKey)` — returns a `TranscriptionModel` from `ai`. The transcription pipeline (`lib/transcribe.ts`) calls this and hands the result to `experimental_transcribe`. **Just-in-time** key handling: the key is only fetched from the vault at the moment of transcription and lives in the closure for the duration of one HTTP request.
- `listModels(apiKey)` — if the provider exposes a public list endpoint, fetch and filter to known transcription model ids. Returns `null` for providers that don't have such an endpoint; the UI falls back to `defaultModels`.
- `defaultModels` — the canonical list shown when `listModels` is null or has not been called yet. Every entry must have a corresponding key in `pricing`.
- `pricing` — per-minute USD rate. Each entry has a `lastUpdated` ISO date; rates are reviewed on a quarterly cadence (see [Pricing maintenance](#pricing-maintenance)).
- `validateKey` (optional) — a quick check (typically a `GET /v1/models` call) that returns `true` if the key is valid. The Settings UI calls this to confirm a freshly-pasted key.

## `listModels` strategies

Three strategies are in use:

1. **Live filter** (`openai`, `groq`) — fetch the provider's full model list, filter to a hard-coded set of known transcription model ids, and return those. The hard-coded set protects against the model list growing to include irrelevant entries (chat models, embeddings, etc.).
2. **Live raw** (`elevenlabs`) — fetch and return the dedicated transcription endpoint's response.
3. **Static** (`null`) — the provider's API has no list endpoint; rely on `defaultModels`. Most providers are in this bucket.

## Pricing maintenance

Each `pricing[modelId]` has a `lastUpdated` field. Provider rates change occasionally; the canonical update process is:

1. Visit each provider's pricing docs (`pricingDocsUrl`).
2. For any rate that has changed, update `perMinuteUSD` and bump `lastUpdated` to today's ISO date.
3. Run the unit tests — the contract test asserts every `defaultModels[i].id` has a `pricing` entry, so a missing rate trips the build.
4. Commit with `chore(providers): refresh <provider-id> pricing`.
5. Run `/sync-docs` — the trigger table calls out provider rate changes as a doc-update obligation.

## Adding a new provider

Use `/add-provider <id> <Name>` — the slash command walks through every step. The short version:

1. Create `packages/desktop/src/providers/<id>.ts` from `openai.ts` as a template.
2. Register in `packages/desktop/src/providers/index.ts` (alphabetical).
3. Write the contract test at `<id>.test.ts`.
4. Add a logo SVG (Plan C — landing).
5. Update this doc's table.
6. Update `packages/desktop/README.md`'s provider table.
7. Run `/test`, `/typecheck`, `/lint`.

## Spec cross-reference

- §6.7 — Provider registry data-driven contract, listModels strategies, pricing maintenance.
