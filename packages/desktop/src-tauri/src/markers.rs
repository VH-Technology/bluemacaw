//! Shared string-based contracts between the Rust backend and the TypeScript
//! webview. These constants are the single source of truth — the mirror file
//! `packages/desktop/src/lib/markers.ts` re-exports the same values for the JS
//! side, and `lib/markers.contract.test.ts` mechanically asserts agreement.
//!
//! Two kinds of contract live here:
//!
//! - `ERR_*` — colon-terminated prefixes returned inside `Result<_, String>`
//!   from Tauri commands. The webview matches with `errMsg.includes(ERR_*)`,
//!   so the trailing `:` is part of the contract — the human-readable detail
//!   follows after the marker.
//! - `EVT_*` — Tauri event names emitted by Rust and listened-for by JS via
//!   `@tauri-apps/api/event::{listen,emit}`. Both sides import the constant
//!   instead of inlining the string.
//!
//! If you rename a constant here, rename it in `markers.ts` too — the
//! contract test parses this file as text and fails loudly on drift.

/// Returned by `paste_text` (and a defensive arm of the Fn hotkey registrar)
/// when macOS Accessibility is not granted, so the synthetic Cmd+V would
/// silently no-op. Webview surfaces a Settings-deep-link message.
pub const ERR_ACCESSIBILITY_REQUIRED: &str = "accessibility-required:";

/// Returned by the recording-controller gate (TS side) when the microphone
/// permission is `Denied` or the user declines the OS prompt. Pinned here
/// so the contract test catches a future Rust-side use too.
pub const ERR_MIC_DENIED: &str = "mic-denied:";

/// Returned by the Linux paste path on a Wayland session, where enigo's
/// X11/XTest backend can't synthesise Ctrl+V. The text IS on the clipboard;
/// the webview shows a "press Ctrl+V manually" message instead of a generic
/// paste failure.
pub const ERR_WAYLAND_PASTE_UNSUPPORTED: &str = "wayland-paste-unsupported:";

/// Returned by `register_hotkey` on macOS when the Fn-key CGEventTap can't
/// be installed because Input Monitoring isn't granted. Distinct from
/// Accessibility — different TCC bucket (`kTCCServiceListenEvent`).
pub const ERR_INPUT_MONITORING_REQUIRED: &str = "input-monitoring-required:";

/// Event Rust emits when the registered global shortcut (or the macOS Fn
/// tap) fires. The main-window hook listens to drive the recording state
/// machine; the overlay window's Stop button re-emits the same event so a
/// click toggles the same machine as the hotkey.
pub const EVT_SHORTCUT_TOGGLE: &str = "bluemacaw://shortcut-toggle";

/// Event Rust emits when the registered cancel global shortcut fires. The
/// main-window hook listens to abort an in-progress recording: capture
/// stops, the audio buffer is discarded, no STT request is made. The
/// overlay's Cancel (X) button re-emits the same event so a click takes
/// the same code path as the hotkey.
pub const EVT_SHORTCUT_CANCEL: &str = "bluemacaw://shortcut-cancel";

/// Event Rust emits during a realtime capture session with each chunk of
/// 16 kHz mono i16 PCM produced. Payload shape is `{ sessionId, samples,
/// sampleRate }` (see `commands::AudioChunkEvent`). The JS-side streaming
/// transcription path subscribes and forwards each chunk to the provider's
/// WebSocket. Batch sessions never emit this event.
pub const EVT_AUDIO_CHUNK: &str = "bluemacaw://audio-chunk";
