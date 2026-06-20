# Providers

bluemacaw ships ten STT (speech-to-text) providers. The registry is data-driven — every provider is a `ProviderConfig` value, registered exactly once in `packages/desktop/src/providers/index.ts`. There is no provider class, no provider factory, no provider DI container. The whole UI (model picker, pricing display, etc.) reads from the same array.

## Bundled providers

| ID | Name | Default models | Has `listModels` |
|---|---|---|---|
| `assemblyai` | AssemblyAI | `universal-3-pro`, `universal-2`, `u3-rt-pro` ⚡ | static |
| `azure-openai` | Azure OpenAI | `whisper` (deployment id) | static |
| `deepgram` | Deepgram | `nova-3`, `nova-2`, `enhanced`, `flux-general-en` ⚡ | static |
| `elevenlabs` | ElevenLabs | `scribe_v2_realtime` ⚡, `scribe_v1` | live (`/v1/models`, filtered to `can_do_transcribe`) |
| `fal` | Fal | `whisper`, `wizper` | static |
| `gladia` | Gladia | `solaria-1`, `solaria-3` | static |
| `groq` | Groq | `whisper-large-v3`, `whisper-large-v3-turbo` | live (`/openai/v1/models`, filtered by `whisper` in id) |
| `openai` | OpenAI | `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` | live (`/v1/models`, filtered to known transcription ids) |
| `revai` | Rev.ai | `machine`, `low_cost` (Reverb Turbo), `fusion` | static |
| `xai` | Grok (xAI) | `grok-stt` | static |

⚡ = `mode: 'realtime'` (streaming). All other models are `mode: 'batch'`.

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
- `gladia.ts` aliases `whisper-large-v3 → solaria-1`. The previous build labeled its single model `whisper-large-v3`, but `@ai-sdk/gladia` never actually sent a `model` field — requests fell back to Gladia's default, which is now Solaria-1. The same file wraps the SDK's `fetch` (`makeModelInjectingFetch`) to inject the selected `model` into the `/v2/pre-recorded` body, since the adapter has no model option.

When removing one of these aliases, delete both the entry in `LEGACY_MODEL_ALIASES` and the corresponding test.

## Realtime (streaming) models

Models with `mode: 'realtime'` stream audio over a WebSocket instead of POSTing a finished recording. A provider that exposes at least one realtime model implements the optional `makeRealtimeModel(modelId, apiKey)` hook, which returns a `RealtimeModel` whose `connect()` opens the session. The recording controller routes to this path automatically when the active model's `mode` is `realtime` (see `lib/transcribe-realtime.ts` → `resolveActiveMode`); no per-provider wiring is needed beyond the config.

The Vercel AI SDK transcription adapters are batch-only, so each realtime provider hand-rolls a small WebSocket client. Shared plumbing lives in `providers/realtime-ws.ts` (the `WebSocketLike` test seam, the Tauri-backed `defaultWebSocketFactory`, binary-frame support, and header/subprotocol auth). Current realtime adapters:

| Provider | Model | Adapter | Auth | Audio frames |
|---|---|---|---|---|
| ElevenLabs | `scribe_v2_realtime` | `elevenlabs-realtime.ts` | single-use token (`?token=`) | base64 PCM in JSON |
| Deepgram | `flux-general-en` | `deepgram-flux-realtime.ts` | `Authorization: Token` header + `token` subprotocol | raw binary PCM (`linear16`) |
| AssemblyAI | `u3-rt-pro` | `assemblyai-realtime.ts` | minted temp token (`?token=`) | raw binary PCM (`pcm_s16le`) |

Each adapter satisfies the `RealtimeSession` contract from `types.ts`: `sendAudio(pcm: Int16Array)`, `finish(): Promise<string>`, `abort()`. Sessions accumulate finalized turn/segment transcripts and join them on `finish()`.

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
    // Optional: direct REST path for providers with no AI SDK adapter (xAI).
    transcribeBatch?: (audio: Uint8Array, modelId: string, apiKey: string) => Promise<string>;
    // Optional: factory for realtime/streaming models (see "Realtime models").
    makeRealtimeModel?: (modelId: string, apiKey: string) => RealtimeModel;
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
