# Local Model STT — Design Spec

**Date:** 2026-07-06
**Branch:** `feat/local-models`
**Status:** approved

## Motivation

bluemacaw currently requires a cloud STT provider API key for every transcription. Users need an offline, in-process alternative that runs natively within the app without external services (e.g. Ollama).

## Repos touched

- **`packages/desktop`** — all implementation lives here (Rust inference engine + TS settings/onboarding UI)
- **`packages/landing`** — optional: mention offline support in feature list
- **`packages/infra`** — **no changes**. Models downloaded from public Hugging Face repos (no self-hosting).

## Architecture overview

### Inference engine: whisper-rs (whisper.cpp)

- `whisper-rs-sys` compiles `whisper.cpp` + `ggml` into a native dylib bundled inside the Tauri app
- **macOS**: Metal GPU acceleration (compiled-in, no user config)
- **Windows**: CPU-only (Vulkan optional, deferred to v2)
- **Model format**: GGUF, downloaded from `huggingface.co/ggerganov/whisper.cpp`
- **Transcription mode**: Batch only in v1 (realtime streaming deferred)

### Model sizes offered

Curated list from `ggerganov/whisper.cpp` on Hugging Face, all English-only variants:

| Model ID | Display Name | Size | Download URL |
|---|---|---|---|
| `ggml-tiny.en` | Tiny (English) | ~75 MB | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin` |
| `ggml-base.en` | Base (English) | ~145 MB | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin` |
| `ggml-small.en` | Small (English) | ~470 MB | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin` |
| `ggml-medium.en` | Medium (English, default) | ~1.5 GB | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin` |
| `ggml-large-v3` | Large v3 | ~3 GB | `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin` |

Users can also paste a custom GGUF URL for alternative fine-tunes.

### Storage

Models stored at `{app_data_dir}/models/{model_id}.gguf`:
- macOS: `~/Library/Application Support/com.vhtechnology.bluemacaw/models/`
- Windows: `%APPDATA%/com.vhtechnology.bluemacaw/models/`

### New Rust dependencies

- `whisper-rs` — inference via whisper.cpp FFI
- `reqwest` — streaming HTTP download with progress

### New Tauri commands

| Command | Signature | Returns |
|---|---|---|
| `download_whisper_model` | `(url: String, model_id: String)` | Emits `download://progress` events; resolves with local path |
| `cancel_model_download` | `(model_id: String)` | `()` |
| `transcribe_local` | `(audio: Vec<u8>, model_id: String)` | `String` — transcription text |
| `delete_local_model` | `(model_id: String)` | `()` |
| `list_local_models` | `()` | `Vec<LocalModel>` — metadata from disk |
| `get_local_model_state` | `(model_id: String)` | `LocalModelState` — not-downloaded / downloading / ready / error |
| `get_local_model_download_progress` | `(model_id: String)` | `Option<{ received: u64, total: u64 }>` |

### New Tauri events (Rust → JS)

- `download://progress` — `{ model_id: String, received: u64, total: u64 }`
- `download://error` — `{ model_id: String, error: String }`
- `download://complete` — `{ model_id: String, local_path: String }`

## Provider integration

A new pseudo-provider `"local"` is added to `PROVIDERS`:

```typescript
const localConfig: ProviderConfig = {
  id: "local",
  name: "Local (on-device)",
  logoSrc: ..., // new SVG icon
  docsUrl: ...,
  apiKeyHelpUrl: "",
  pricingDocsUrl: "",
  makeModel: () => { throw new Error("Local model: use transcribeBatch"); },
  transcribeBatch: async (audio, modelId) => {
    return await vox.transcribeLocal(audio, modelId);
  },
  makeRealtimeModel: undefined, // v2
  listModels: null,
  defaultModels: [tiny, base, small, medium, large],
  pricing: {}, // free
  validateKey: async () => true, // no key needed
};
```

### Active model resolution

When the active model config's provider is `"local"` (or when `active_local_model_id` is set in `app_state`), `transcribe()` in `src/lib/transcribe.ts` routes to `provider.transcribeBatch` which calls the Rust `transcribe_local` command. No API key lookup happens.

We use a separate `app_state` key `active_local_model_id` (rather than overloading the existing `active_model_config_id` foreign key). The `resolveActiveMode()` function checks this key first; if set, transcription uses the local path.

## Settings UI

### New section: Settings → Local Models

Inserted between "Models" and "Recording" in `SETTINGS_SECTIONS`.

Shows:
- List of downloaded models (model display name, size, download date, "Active" badge if selected)
- "Download a model" button → opens dialog with:
  - Predefined model size picker (radio cards, one per size)
  - "Custom URL" text input (collapsed by default)
  - Download progress bar during active download
- "Delete" button per model (with confirmation when active)
- Click a downloaded model row to set it as active

Active model toggling is exclusive: activating a local model deactivates the cloud model config (clears `active_model_config_id`). Conversely, activating a cloud model config clears `active_local_model_id`.

## Onboarding changes

### New step 3a½: Choose model source

After hotkeys (step 2), before API key (step 3a), insert a branching step:

**OnboardingStepChooseModelSource.tsx**
- Two options presented as cards:
  1. **"Cloud provider"** — uses an API key (proceeds to existing step 3a)
  2. **"Local model (on-device)"** — downloads and runs locally (proceeds to new step 3b)
- "I'll do it later" skip available

### New step 3b: Download Local Model (when "Local model" chosen)

**OnboardingStepLocalModel.tsx**
- Shows the 5 model sizes with short descriptions
- Default selection: Medium (English)
- "Download" button begins download with progress bar
- On completion: model is saved, set as active, onboarding finishes
- "I'll do it later" skip available (user can download later from Settings)

### Step order update

```typescript
const STEP_ORDER = [1, 2, '3a', '3a½', '3b', '3c'] as const;
type Step = typeof STEP_ORDER[number];
```

```
'permissions' → step 1
'hotkeys'     → step 2
'model-source' → step '3a'  (was: api-key)
'api-key'     → step '3a½' (was step 3a)
'model'       → step '3b'  (cloud model, was step 3b)
'local-model' → step '3c'  (new)
```

### Silent-skip predicates

Add:
- `hasLocalModelSet()` — `SELECT COUNT(*) FROM local_models WHERE active = 1`
- Update `shouldSilentSkip()` to check `hasLocalModelSet()` OR the existing `hasApiKeySet() AND hasModelConfigSet()`

### Completion flag

Bump to `onboarding_v3_completed` so existing users (with `onboarding_v2_completed`) re-onboard once and get the model-source choice.

## Realtime support (deferred to v2)

- whisper.cpp supports streaming (partial transcription on buffered audio chunks)
- Will require threading rework: model context kept alive, incremental audio feeding
- Excluded from v1 scope

## Windows GPU acceleration (deferred to v2)

- whisper.cpp can compile with Vulkan or CUDA
- Requires CI dependency changes and testing on GPU-capable Windows runners
- CPU-only on Windows for v1 using BLAS acceleration
