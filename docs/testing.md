# Testing

bluemacaw's test pyramid has **four layers**, each with a clear contract about what it can and can't observe. This is per spec §9; the implementations live under `packages/desktop/`.

## The four layers

### 1. Rust unit tests (`cargo test --lib`)

**Where:** `#[cfg(test)] mod tests` blocks at the bottom of each Rust module.

**Scope:** pure logic, trait contracts, in-memory implementations of side-effecting traits.

Examples:

- `audio/mod.rs` — `PermissionState` (de)serialization round-trips.
- `secrets/mod.rs` — `InMemoryVault` get/set/delete semantics; `SecretKey::Debug` redaction.
- `audio/microphone.rs` — WAV encoding (`encode_wav_pcm16`) round-trip; session bookkeeping; peak-level reset on read; poisoned-mutex behaviour.
- `clipboard/mod.rs` — `InMemoryClipboard` read/write/overwrite + trait-object behaviour.
- `login_launch.rs` — the login-launch decision (`--autostart` flag, the two-minute window after the console login, clock skew) and console-record selection, over literal inputs. The utmpx read itself and the real behaviour at login are not automated: verify by logging out and back in with "Start at login" on and confirming only the tray icon appears.
- `paste/mod.rs` — `RecordingPaster` records calls and writes the test clipboard. `paste/macos.rs` tests the production shortcut sequencing with injected key-operation failures, including Command cleanup and permission-error mapping. Native event delivery is checked separately with the probe below.
- `shortcut/macos_fn.rs` / `shortcut/macos_chord.rs` — synthetic paste events cannot retrigger or corrupt physical Fn/chord/double-tap state.
- `shortcut/parse.rs` — combo parser / formatter round-trips, case insensitivity, alias normalisation (Option/Alt, Cmd/Meta), function/arrow keys, exhaustive modifier combinations.
- `audio/permissions/mod.rs` — the platform module is wired up and returns *some* `PermissionState`. We deliberately do not assert which, because CI runners and dev machines differ.
- `apple_intelligence/mod.rs` — the sidecar protocol, the macOS 27 gate, and process handling (stdin request, error/crash reporting, timeout kill), driven by `/bin/sh` scripts standing in for the Swift sidecar. `real_sidecar_cleans_up_a_transcript` is `#[ignore]`d. It runs the real sidecar against Apple's on-device model; on a macOS 27 Mac with Apple Intelligence on, run `cargo test --lib apple_intelligence -- --ignored`.

History CRUD, retention, and stats live JS-side in `lib/db.ts` rather than in Rust (a divergence from Plan B). They are tested under the Vitest layer below — see `lib/db.test.ts` and the `__tests__/db-harness.ts` helper, which runs against an in-process `better-sqlite3` database with the migration SQL applied per test.

**What it does NOT do:** spin up a Tauri app, talk to the real keyring, talk to the real microphone, hit any network.

### 2. Vitest unit tests (`bun run test:unit`)

**Where:** `packages/desktop/src/**/*.test.ts(x)`, excluding `tests/integration/**` and `tests/functional/**`.

**Scope:** TypeScript pure functions, React components in isolation, the data-driven provider contract.

Examples:

- `lib/utils.test.ts`, `lib/invoke.test.ts`, `lib/invoke.contract.test.ts` — pure helpers and the `invoke` wrapper. `invoke.contract.test.ts` pins the TS wrapper signatures against the Rust command surface.
- `lib/markers.contract.test.ts` — parses `src-tauri/src/markers.rs` as text and asserts every `pub const NAME: &str = "VALUE";` has a matching named export in `lib/markers.ts` with an identical value. This is the load-bearing guard against Rust/TS drift on event names and error prefixes.
- `lib/db.test.ts` (≈32 KB) — covers api_keys, model_configs, transcription history, retention purges, app_state settings, and stats aggregations against `better-sqlite3`.
- `lib/recording-controller.test.ts` — the state-machine, with `vox.*` mocked.
- `providers/<id>.test.ts` — the contract test. Asserts presence in `PROVIDERS`, non-empty `defaultModels`, every default model has pricing, every pricing entry corresponds to a default model. For providers with `listModels`, also covers the request shape and a couple of error branches via `vi.fn()` mocking of `fetch`. `assemblyai.test.ts` additionally pins the `speech_model` → `speech_models` request-body rewrite.
- `windows/main/*.test.tsx` and `windows/overlay/*.test.tsx` — React Testing Library renders against happy-dom; user interactions via `@testing-library/user-event`.

**What it does NOT do:** make real network calls, touch a real Tauri app, exercise the Rust code path. `@tauri-apps/api/core`'s `invoke` is mocked.

### 3. Integration tests (`bun run test:integration`)

**Where:** `packages/desktop/tests/integration/**/*.test.ts`.

**Scope:** wire several modules together with mocks at the OS boundary.

This layer is reserved for cross-module flows that don't need a full app context but do need more than one module cooperating — e.g., a settings change rippling into a provider switch, exercised through the Vitest test runner with `MockMicrophoneSource` + `InMemoryVault`.

This layer is currently lean; expect it to grow as features land.

### 4. Functional tests (`bun run test:functional`)

**Where:** `packages/desktop/tests/functional/**/*.test.ts`.

**Scope:** the full transcribe flow, end to end, with the network mocked at the HTTP layer via [MSW v2](https://mswjs.io/).

The canonical example is `tests/functional/transcribe-flow.test.ts`:

1. Build a `Blob` from a committed audio fixture under `tests/fixtures/audio/`.
2. Mock `vox.getSecret` to return a fake key.
3. Stand up MSW handlers for the OpenAI transcription endpoint, returning a known `text`.
4. Call `transcribe(blob)` from `lib/transcribe.ts`.
5. Assert the returned text matches what the mock returned.

This layer is the load-bearing one for refactor safety: it pins down the contract between the webview, the providers, and `experimental_transcribe`.

## Mocking boundaries

The rule is: **mock at the trait boundary or the network boundary, never in between.**

- Rust: implement `Vault`, `AudioSource`, `Paster`, `ShortcutManager` with in-memory variants. Tests construct an `AppState` from the in-memory variants when they need the command surface.
- TypeScript: mock `@tauri-apps/api/core`'s `invoke` for unit tests; use MSW for HTTP. Don't mock `experimental_transcribe` itself — mock the HTTP it makes.
- Never mock React. Render with happy-dom + RTL; interact with user-event.

## Audio fixtures

Functional tests need real audio bytes. The committed fixtures under `packages/desktop/tests/fixtures/audio/` are deterministically synthesized via `tests/fixtures/audio/synth.ts` and `regenerate.ts`. Each fixture is a short WebM/PCM blob keyed by the test that uses it. To regenerate:

```bash
cd packages/desktop && bun run tests/fixtures/audio/regenerate.ts
```

The regeneration script is hermetic — it does not call the network and does not need a microphone. It writes deterministic samples (sine waves, silence, etc.) using `hound`-style WAV synthesis ported to TS.

Do not commit fixtures recorded from real microphones — they vary across hardware, embed environment noise, and don't replay deterministically.

## Coverage

Measured by `@vitest/coverage-v8` on the TS side; run with `/coverage`. The Rust crate is not measured by Vitest — use `cargo llvm-cov --lib` if you need a Rust coverage report (Plan B does not require one).

Coverage policy (per spec §9):

- Provider registry: 100% on the data-driven contract.
- `lib/transcribe.ts`: covered by the functional layer.
- React components: at least one render + interaction test per Settings tab.
- Rust trait impls: every public method exercised by at least one Rust unit test.

A missing-coverage failure is not a CI gate today — we surface the report and review it manually.

## When to write what

- **Pure logic** → Rust unit test or Vitest unit test, depending on which side it lives on.
- **Cross-module flow without OS dependencies** → Integration layer.
- **End-to-end transcribe-style flow** → Functional layer with MSW.
- **OS-level behavior** — `cpal` actually capturing audio, `keyring` actually writing the keychain — is exercised manually via `/dev-desktop` and `/build-clean`. There is no automated harness for OS-level behavior; that's a deliberate scope decision (the cost of CI runners with real mics + keychains exceeds the value at v1).

## macOS native paste probe

`packages/desktop/src-tauri/examples/paste_probe.rs` runs the production
`EnigoPaster` on the main thread, with a `pbcopy`/`pbpaste` clipboard adapter and
a listen-only event tap. It captures only this process's tagged paste events
(keycodes, flags, source IDs, and timing), not unrelated typing or clipboard
contents. It is an opt-in diagnostic, not part of the unattended test suite.

From `packages/desktop/src-tauri`:

```sh
cargo run --example paste_probe -- --check-permissions
cargo run --example paste_probe -- 100
```

The probe's host process needs Accessibility and Input Monitoring. After the
five-second countdown it pastes numbered lines into the focused field and
checks that both V events carry Command without other shortcut modifiers,
the event source is private, and the final Command release is present.

Focus a disposable text field before the countdown ends. Run once with the
pointer stationary and again while moving the physical mouse. Also check
physical hotkey releases near completion and held modifiers. Verify exactly
one complete numbered line per request in the receiving field: observing
events alone does not prove the application accepted the paste.

Repeat in TextEdit, a browser text area, and an Electron editor, including
selection replacement and non-US/Dvorak layouts. Test the actual app with Fn,
modifier chords, and double-tap Command to confirm paste never toggles recording
and physical modifiers continue working afterward.

## Spec cross-reference

- §9 — 4-layer testability architecture, mocking boundaries, audio fixtures, coverage policy.
