/**
 * Shared string-based contracts between the Rust backend and the TypeScript
 * webview. These constants MUST stay in lockstep with
 * `packages/desktop/src-tauri/src/markers.rs` — the contract test
 * (`markers.contract.test.ts`) parses the Rust file as text and asserts every
 * `pub const NAME: &str = "VALUE";` has a matching named export here with an
 * identical value.
 *
 * Two kinds of contract live here:
 *
 * - `ERR_*` — colon-terminated prefixes that Rust commands return inside
 *   `Result<_, String>`. The webview matches with `errMsg.includes(ERR_*)`,
 *   so the trailing `:` is part of the contract — the human-readable detail
 *   follows after the marker.
 * - `EVT_*` — Tauri event names. Pass them to `listen()` / `emit()` from
 *   `@tauri-apps/api/event` instead of inlining the string.
 */

export const ERR_ACCESSIBILITY_REQUIRED = 'accessibility-required:';
export const ERR_MIC_DENIED = 'mic-denied:';
export const ERR_WAYLAND_PASTE_UNSUPPORTED = 'wayland-paste-unsupported:';
export const ERR_INPUT_MONITORING_REQUIRED = 'input-monitoring-required:';
export const EVT_SHORTCUT_TOGGLE = 'bluemacaw://shortcut-toggle';
export const EVT_SHORTCUT_CANCEL = 'bluemacaw://shortcut-cancel';
export const EVT_AUDIO_CHUNK = 'bluemacaw://audio-chunk';
