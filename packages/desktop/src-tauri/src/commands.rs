use crate::audio::{AudioDeviceInfo, AudioSource, CaptureSession, PermissionState, microphone::MicrophoneSource, resampler::Resampler};
use crate::markers::{ERR_ACCESSIBILITY_REQUIRED, EVT_AUDIO_CHUNK, EVT_SHORTCUT_CANCEL, EVT_SHORTCUT_TOGGLE};
#[cfg(target_os = "macos")]
use crate::markers::ERR_INPUT_MONITORING_REQUIRED;
#[cfg(target_os = "linux")]
use crate::markers::ERR_WAYLAND_PASTE_UNSUPPORTED;
use crate::paste::Paster;
use crate::platform::is_wayland_session;
use crate::secrets::Vault;
use crate::shortcut::HotkeyCombo;
use crate::shortcut::parse::{
    format_combo, parse_combo, parse_combo_permissive, parse_double_tap, parse_modifiers_only,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use uuid::Uuid;

#[cfg(target_os = "macos")]
use crate::shortcut::{ShortcutManager, macos_chord::MacOsChordTap, macos_fn::MacOsFnTap};

/// Application state shared across Tauri commands.
///
/// Each field is a trait object so production wiring (real impls) can be
/// swapped for in-memory mocks in tests. The clipboard is owned by the
/// `Paster` (per spec §6.10 — `paste_text` combines clipboard write +
/// keystroke), so it does not appear here as a separate field.
///
/// `current_hotkey` tracks the currently registered global shortcut so
/// `register_hotkey` can unregister the previous combo before binding a
/// new one. The JS side owns hotkey lifecycle on app start (per spec).
pub struct AppState {
    pub audio: Box<dyn AudioSource>,
    pub vault: Box<dyn Vault>,
    /// `Arc` (not `Box`) so the paster can be cloned into other contexts
    /// if needed. The paste command itself is sync — see the comment on
    /// [`paste_text`] for why we don't dispatch the keystroke off the
    /// Tauri command thread on macOS.
    pub paster: Arc<dyn Paster>,
    pub current_hotkey: Mutex<Option<Shortcut>>,
    /// Mirror of `current_hotkey` for the cancel-recording global shortcut.
    /// Held in parallel so the user can independently rebind either combo;
    /// the Tauri global-shortcut plugin tracks each `Shortcut` handle
    /// separately, so two registrations coexist without conflict.
    pub current_cancel_hotkey: Mutex<Option<Shortcut>>,
    /// macOS Fn-key tap. Lazily initialized the first time the user picks
    /// `"Fn"` as their hotkey. Once running it survives the app lifetime
    /// (CFRunLoop has no clean stop in v1); switching back to a standard
    /// combo just unregisters the global shortcut, the dormant tap stays.
    #[cfg(target_os = "macos")]
    pub fn_tap: Mutex<Option<Arc<MacOsFnTap>>>,
    /// macOS chord tap — handles modifier-only chord shortcuts and
    /// double-tap-modifier shortcuts. Lazily initialized the first time
    /// the user picks such a combo. Same v1 lifecycle caveat as
    /// `fn_tap`: tap thread survives the app lifetime, switching
    /// shortcuts just drops the binding.
    #[cfg(target_os = "macos")]
    pub chord_tap: Mutex<Option<Arc<MacOsChordTap>>>,
}

/// Platform identifier emitted to the JS side. The webview keys per-OS
/// behaviour off this value (e.g. which permission rows to show, whether
/// to display the Wayland paste-fallback banner), so the variants must
/// stay aligned with the `os: 'macos' | 'windows' | 'linux'` union in
/// `lib/platform.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HostOs {
    Macos,
    Windows,
    Linux,
}

/// Platform context surfaced to the onboarding screen.
///
/// `isWayland` is always `false` on macOS/Windows; on Linux it reflects
/// `XDG_SESSION_TYPE` / `WAYLAND_DISPLAY` via [`crate::platform::is_wayland_session`].
/// `rename_all = "camelCase"` keeps the JS read site clean (`info.isWayland`).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: HostOs,
    pub is_wayland: bool,
}

/// Returns the current host OS and (on Linux) whether the session is
/// running under Wayland. Drives the onboarding screen's per-platform
/// permission row set and the Wayland paste-fallback info banner.
#[tauri::command]
pub fn get_platform_info() -> PlatformInfo {
    #[cfg(target_os = "macos")]
    let os = HostOs::Macos;
    #[cfg(target_os = "windows")]
    let os = HostOs::Windows;
    #[cfg(target_os = "linux")]
    let os = HostOs::Linux;
    // `is_wayland_session` returns false on macOS/Windows by construction,
    // so we can call it unconditionally without a `cfg`-cascade here.
    PlatformInfo {
        os,
        is_wayland: is_wayland_session(),
    }
}

/// Restart the running bluemacaw process. Called from the onboarding screen
/// after the user grants Accessibility / Input Monitoring on macOS, since
/// TCC doesn't propagate authorisation changes into a running process.
///
/// `AppHandle::restart` is the canonical Tauri 2 relaunch path — it spawns
/// a new instance of the current executable and terminates the old one.
/// The function is `-> !` on Tauri 2 (it never returns), so we don't try to
/// surface a result; emitting an event before the restart isn't worth the
/// race against the process exit.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    log::info!("restart_app: relaunching bluemacaw");
    app.restart();
}

#[tauri::command]
pub fn check_microphone_permission(state: State<'_, AppState>) -> PermissionState {
    state.audio.check_permission()
}

#[tauri::command]
pub fn request_microphone_permission(
    state: State<'_, AppState>,
) -> Result<PermissionState, String> {
    state.audio.request_permission().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn check_accessibility_permission() -> PermissionState {
    crate::audio::permissions::check_accessibility_permission()
}

/// Same TCC bucket as [`check_accessibility_permission`] but uses
/// `prompt:true` under the hood so the first invocation when the process
/// is not yet trusted raises the native macOS "Open System Settings"
/// dialog. Frontend convention: call this on an explicit user gesture
/// (e.g. clicking the "Grant Accessibility" button) and call the
/// non-prompting variant during passive status polling.
#[tauri::command]
pub fn check_accessibility_permission_prompting() -> PermissionState {
    crate::audio::permissions::check_accessibility_permission_prompting()
}

#[tauri::command]
pub fn request_accessibility_permission() -> Result<(), String> {
    crate::audio::permissions::request_accessibility_permission().map_err(|e| e.to_string())
}

/// Input Monitoring status — the permission the Fn-key `CGEventTap` needs.
/// Distinct from Accessibility on macOS (`kTCCServiceListenEvent` vs
/// `kTCCServiceAccessibility`).
#[tauri::command]
pub fn check_input_monitoring_permission() -> PermissionState {
    crate::audio::permissions::check_input_monitoring_permission()
}

/// Kick off the macOS Input Monitoring authorization flow via
/// `CGRequestListenEventAccess`. The OS dialog appears asynchronously and
/// the grant only takes effect after the user toggles the switch *and*
/// the app is relaunched (TCC does not propagate authorization changes to
/// a running process). Callers should poll
/// [`check_input_monitoring_permission`] and prompt the user to quit and
/// reopen bluemacaw.
#[tauri::command]
pub fn request_input_monitoring_permission() -> Result<PermissionState, String> {
    crate::audio::permissions::request_input_monitoring_permission()
        .map_err(|e| e.to_string())
}

/// Settings panel the webview can ask the OS to surface. Serde rejects any
/// other value at deserialize time, so a typo on the JS side fails with a
/// structured IPC error instead of round-tripping through a `match` arm as
/// a runtime `unknown panel: ...` string. The kebab-case rename keeps the
/// existing JS contract (`'microphone' | 'accessibility' | 'input-monitoring'`)
/// intact — no TS-side changes needed.
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SettingsPanelKind {
    Microphone,
    Accessibility,
    InputMonitoring,
}

#[tauri::command]
pub fn open_settings_panel(panel: SettingsPanelKind) -> Result<(), String> {
    use crate::audio::permissions::{
        open_settings_accessibility_panel, open_settings_input_monitoring_panel,
        open_settings_microphone_panel,
    };
    match panel {
        SettingsPanelKind::Microphone => open_settings_microphone_panel().map_err(|e| e.to_string()),
        SettingsPanelKind::Accessibility => open_settings_accessibility_panel().map_err(|e| e.to_string()),
        SettingsPanelKind::InputMonitoring => open_settings_input_monitoring_panel().map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn start_recording(
    state: State<'_, AppState>,
    device_id: Option<String>,
) -> Result<String, String> {
    let session = state
        .audio
        .start_capture_with_device(device_id.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(session.id.to_string())
}

/// Tauri event payload emitted for each chunk of resampled audio during a
/// realtime capture session. `samples` is mono 16-bit PCM at
/// [`Resampler::target_rate()`] (16 kHz). Camel-cased to match the
/// existing JS-side event payload conventions.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioChunkEvent {
    pub session_id: String,
    pub samples: Vec<i16>,
    pub sample_rate: u32,
}

/// Realtime variant of [`start_recording`]. Same capture pipeline, but the
/// audio source also emits `EVT_AUDIO_CHUNK` Tauri events with 16 kHz mono
/// i16 PCM chunks as recording progresses. The buffered WAV is still
/// available via `stop_recording` exactly as in batch mode, so the caller
/// can fall back to a final-shot transcribe if the streaming session
/// fails mid-utterance.
#[tauri::command]
pub fn start_recording_realtime(
    app: AppHandle,
    state: State<'_, AppState>,
    device_id: Option<String>,
) -> Result<String, String> {
    let app_for_callback = app.clone();
    let on_chunk: crate::audio::RealtimeChunkCallback =
        Box::new(move |session_id, samples| {
            let payload = AudioChunkEvent {
                session_id: session_id.to_string(),
                samples: samples.to_vec(),
                sample_rate: Resampler::target_rate(),
            };
            if let Err(e) = app_for_callback.emit(EVT_AUDIO_CHUNK, payload) {
                // emit only fails if the AppHandle's runtime is gone, which
                // means the app is shutting down — log and let the emitter
                // thread exit naturally on the next channel close.
                log::warn!("audio-chunk emit failed: {e}");
            }
        });
    let session = state
        .audio
        .start_capture_realtime(device_id.as_deref(), on_chunk)
        .map_err(|e| e.to_string())?;
    Ok(session.id.to_string())
}

#[tauri::command]
pub fn stop_recording(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<u8>, String> {
    let id = Uuid::parse_str(&session_id).map_err(|e| e.to_string())?;
    let session = CaptureSession { id };
    state.audio.stop_capture(&session).map_err(|e| e.to_string())
}

/// Abort an in-progress recording: stops capture and discards the buffered
/// audio. The session is dropped without ever reaching the STT pipeline.
/// Used by the cancel-recording hotkey + the overlay's Cancel button.
#[tauri::command]
pub fn cancel_recording(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let id = Uuid::parse_str(&session_id).map_err(|e| e.to_string())?;
    let session = CaptureSession { id };
    state
        .audio
        .cancel_capture(&session)
        .map_err(|e| e.to_string())
}

/// Returns the loudest sample amplitude observed since the previous call,
/// normalized to 0.0..=1.0. The Rust side resets the tracked peak on each
/// read, so polling this at ~12 Hz produces a smooth meter that decays
/// naturally to zero when the user stops speaking.
///
/// Returns 0.0 when the session isn't known to the audio source (e.g. the
/// mock impl doesn't track levels) so the UI never has to special-case a
/// missing meter.
#[tauri::command]
pub fn get_recording_level(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<f32, String> {
    let id = Uuid::parse_str(&session_id).map_err(|e| e.to_string())?;
    let session = CaptureSession { id };
    Ok(state.audio.peak_level(&session).unwrap_or(0.0))
}

#[tauri::command]
pub fn get_secret(
    state: State<'_, AppState>,
    secret_id: String,
) -> Result<Option<String>, String> {
    let opt = state.vault.get(&secret_id).map_err(|e| e.to_string())?;
    Ok(opt.map(|z| z.to_string()))
}

#[tauri::command]
pub fn set_secret(
    state: State<'_, AppState>,
    secret_id: String,
    key: String,
) -> Result<(), String> {
    state
        .vault
        .set(&secret_id, &key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_secret(state: State<'_, AppState>, secret_id: String) -> Result<(), String> {
    state.vault.delete(&secret_id).map_err(|e| e.to_string())
}

/// Combined clipboard write + paste keystroke (Cmd+V on macOS, Ctrl+V
/// elsewhere). The paster owns the clipboard internally per spec §6.10.
///
/// On macOS, `enigo` synthesises the keystroke via `CGEventPost`, which silently
/// no-ops when the bound process lacks Accessibility permission. We probe the
/// permission up front and return a structured `accessibility-required:` error
/// so the React side can surface a useful message instead of "text on
/// clipboard but nothing happened".
///
/// The command MUST be sync. Tauri's sync command runner dispatches the
/// call on a thread context that AppKit/HIToolbox accepts; if we made the
/// command `async` and ran the work via `tauri::async_runtime::spawn_blocking`,
/// enigo's `TSMGetInputSourceProperty` call inside `Enigo::key()` would hit
/// `dispatch_assert_queue_fail` on macOS 14+ and abort the process. The
/// ~80 ms `PBOARD_SETTLE_DELAY` sleep is short enough that holding a Tauri
/// command thread for that duration is fine in practice. The JS-visible
/// contract (command name, `text` arg, error shapes including the
/// `accessibility-required:` and `wayland-paste-unsupported:` markers) is
/// unchanged.
#[tauri::command]
pub fn paste_text(state: State<'_, AppState>, text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let perm = crate::audio::permissions::check_accessibility_permission();
        if perm != crate::audio::PermissionState::Granted {
            log::warn!(
                "paste_text: Accessibility permission not granted; keystroke will silently no-op"
            );
            return Err(format!(
                "{ERR_ACCESSIBILITY_REQUIRED} synthetic paste needs Accessibility. Grant bluemacaw in System Settings → Privacy & Security → Accessibility, then try again."
            ));
        }
    }
    log::info!(
        "paste_text: dispatching {} chars to clipboard + paste keystroke",
        text.chars().count(),
    );
    let result = state.paster.paste_text(&text);
    #[cfg(target_os = "linux")]
    if let Err(ref e) = result {
        if e.starts_with(ERR_WAYLAND_PASTE_UNSUPPORTED) {
            log::warn!(
                "paste_text: Wayland fallback engaged; clipboard write succeeded but synthetic Ctrl+V was skipped"
            );
        }
    }
    result
}

#[tauri::command]
pub fn list_audio_input_devices() -> Vec<AudioDeviceInfo> {
    MicrophoneSource::list_devices().unwrap_or_default()
}

/// Routes the raw `combo` string the JS side sends into the existing typed
/// [`HotkeyCombo`] enum. Recognises three macOS-specific markers before
/// falling back to the standard combo path:
///
/// * `"Fn"` (case-insensitive) → [`HotkeyCombo::Fn`]
/// * `"DoubleTap+<Mod>"` → [`HotkeyCombo::DoubleTap`]
/// * two-or-more bare modifier names like `"Cmd+Opt"` →
///   [`HotkeyCombo::ModifiersOnly`]
///
/// Anything else falls through to [`HotkeyCombo::Standard`] and goes
/// through `tauri-plugin-global-shortcut`. The JS contract — a single
/// `combo` string — is unchanged.
fn parse_combo_input(input: &str) -> Result<HotkeyCombo, String> {
    let trimmed = input.trim();
    if trimmed.eq_ignore_ascii_case("fn") {
        return Ok(HotkeyCombo::Fn);
    }
    if let Some(modifier) = parse_double_tap(trimmed).map_err(|e| e.to_string())? {
        return Ok(HotkeyCombo::DoubleTap { modifier });
    }
    if let Some(mods) = parse_modifiers_only(trimmed).map_err(|e| e.to_string())? {
        return Ok(HotkeyCombo::ModifiersOnly { mods: mods.0 });
    }
    Ok(HotkeyCombo::Standard { combo: input.to_string() })
}

#[tauri::command]
pub fn register_hotkey(
    app: AppHandle,
    state: State<'_, AppState>,
    combo: String,
) -> Result<String, String> {
    let parsed = parse_combo_input(&combo)?;
    let combo_str = match parsed {
        HotkeyCombo::Fn => return register_fn_hotkey(&app, &state),
        HotkeyCombo::ModifiersOnly { mods } => {
            return register_chord_hotkey(
                &app,
                &state,
                HotkeyCombo::ModifiersOnly { mods },
                format!("modifiers-only(0x{mods:x})"),
            );
        }
        HotkeyCombo::DoubleTap { modifier } => {
            return register_chord_hotkey(
                &app,
                &state,
                HotkeyCombo::DoubleTap { modifier },
                format!("double-tap(0x{modifier:x})"),
            );
        }
        HotkeyCombo::Standard { combo } => combo,
    };
    let shortcut = parse_combo(&combo_str).map_err(|e| e.to_string())?;
    let mut current = state.current_hotkey.lock().map_err(|e| e.to_string())?;
    if let Some(prev) = current.take() {
        let _ = app.global_shortcut().unregister(prev);
    }
    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_, _, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app_clone.emit(EVT_SHORTCUT_TOGGLE, ());
            }
        })
        .map_err(|e| e.to_string())?;
    *current = Some(shortcut);
    Ok(format_combo(&shortcut))
}

#[cfg(target_os = "macos")]
fn register_fn_hotkey(
    app: &AppHandle,
    state: &State<'_, AppState>,
) -> Result<String, String> {
    // Make sure no standard global shortcut is also live so we don't get
    // double-toggle from two backends.
    {
        let mut current = state.current_hotkey.lock().map_err(|e| e.to_string())?;
        if let Some(prev) = current.take() {
            let _ = app.global_shortcut().unregister(prev);
        }
    }
    let mut tap_slot = state.fn_tap.lock().map_err(|e| e.to_string())?;
    if tap_slot.is_some() {
        // Tap already running from a prior register; idempotent success.
        return Ok("Fn".to_string());
    }
    let app_clone = app.clone();
    let tap = Arc::new(MacOsFnTap::new(move || {
        let _ = app_clone.emit(EVT_SHORTCUT_TOGGLE, ());
    }));
    tap.register(HotkeyCombo::Fn).map_err(|e| match e {
        crate::shortcut::ShortcutError::InputMonitoringRequired => {
            // TCC changes do NOT propagate to a running process. The user
            // must quit and reopen after toggling the switch, otherwise the
            // tap will keep failing even though Settings shows "on".
            format!("{ERR_INPUT_MONITORING_REQUIRED} grant bluemacaw in System Settings → Privacy & Security → Input Monitoring, then quit and reopen the app")
        }
        crate::shortcut::ShortcutError::AccessibilityRequired => {
            // Defensive: the Fn tap should never surface this variant any
            // more, but if a future backend path does we still want a sane
            // message. Paste uses Accessibility — hence the wording.
            format!("{ERR_ACCESSIBILITY_REQUIRED} grant bluemacaw in System Settings → Privacy & Security → Accessibility, then try again")
        }
        other => other.to_string(),
    })?;
    *tap_slot = Some(tap);
    Ok("Fn".to_string())
}

#[cfg(not(target_os = "macos"))]
fn register_fn_hotkey(
    _app: &AppHandle,
    _state: &State<'_, AppState>,
) -> Result<String, String> {
    Err("Fn key shortcut is only supported on macOS".to_string())
}

#[cfg(target_os = "macos")]
fn register_chord_hotkey(
    app: &AppHandle,
    state: &State<'_, AppState>,
    combo: HotkeyCombo,
    label: String,
) -> Result<String, String> {
    // Drop any plugin-managed standard shortcut so we don't double-fire
    // from two backends, mirroring `register_fn_hotkey`.
    {
        let mut current = state.current_hotkey.lock().map_err(|e| e.to_string())?;
        if let Some(prev) = current.take() {
            let _ = app.global_shortcut().unregister(prev);
        }
    }
    // Drop any prior chord tap (the tap's run loop survives, but the
    // binding is replaced). Each new chord-mode picks gets a fresh
    // `MacOsChordTap` because the mode is baked in at construction.
    let mut tap_slot = state.chord_tap.lock().map_err(|e| e.to_string())?;
    let app_clone = app.clone();
    let tap = Arc::new(
        MacOsChordTap::new(
            move || {
                let _ = app_clone.emit(EVT_SHORTCUT_TOGGLE, ());
            },
            &combo,
        )
        .map_err(|e| e.to_string())?,
    );
    tap.register(combo).map_err(|e| match e {
        crate::shortcut::ShortcutError::InputMonitoringRequired => format!(
            "{ERR_INPUT_MONITORING_REQUIRED} grant bluemacaw in System Settings → Privacy & \
             Security → Input Monitoring, then quit and reopen the app"
        ),
        crate::shortcut::ShortcutError::AccessibilityRequired => format!(
            "{ERR_ACCESSIBILITY_REQUIRED} grant bluemacaw in System Settings → Privacy & Security \
             → Accessibility, then try again"
        ),
        other => other.to_string(),
    })?;
    *tap_slot = Some(tap);
    Ok(label)
}

#[cfg(not(target_os = "macos"))]
fn register_chord_hotkey(
    _app: &AppHandle,
    _state: &State<'_, AppState>,
    _combo: HotkeyCombo,
    _label: String,
) -> Result<String, String> {
    Err(
        "Modifier-only chord and double-tap shortcuts are only supported on macOS in this version"
            .to_string(),
    )
}

#[tauri::command]
pub fn unregister_hotkey(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut current = state.current_hotkey.lock().map_err(|e| e.to_string())?;
    if let Some(prev) = current.take() {
        app.global_shortcut()
            .unregister(prev)
            .map_err(|e| e.to_string())?;
    }
    // Note: the macOS Fn-key CGEventTap thread cannot be cleanly stopped
    // in v1. If a Fn tap is running it stays alive; switching to a standard
    // combo just leaves the tap dormant (it only fires on Fn presses).
    Ok(())
}

/// Register a global shortcut whose press emits `EVT_SHORTCUT_CANCEL`. The
/// frontend listens for that event and aborts an in-progress recording.
///
/// Unlike `register_hotkey`, the Fn-key path is intentionally NOT supported
/// here — the cancel hotkey is meant to be distinct from the toggle and
/// only one Fn-tap can ever be installed, so allowing `"Fn"` would either
/// collide with the toggle path or silently no-op.
///
/// The permissive combo parser is used so a bare key like `"Esc"` is
/// accepted. That's only safe because the JS side registers the cancel
/// hotkey *while a recording is in flight* and unregisters it again the
/// moment the recording ends — Esc is not globally swallowed during
/// idle / transcribing / error states.
#[tauri::command]
pub fn register_cancel_hotkey(
    app: AppHandle,
    state: State<'_, AppState>,
    combo: String,
) -> Result<String, String> {
    let shortcut = parse_combo_permissive(&combo).map_err(|e| e.to_string())?;
    let mut current = state
        .current_cancel_hotkey
        .lock()
        .map_err(|e| e.to_string())?;
    if let Some(prev) = current.take() {
        let _ = app.global_shortcut().unregister(prev);
    }
    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_, _, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app_clone.emit(EVT_SHORTCUT_CANCEL, ());
            }
        })
        .map_err(|e| e.to_string())?;
    *current = Some(shortcut);
    Ok(format_combo(&shortcut))
}

#[tauri::command]
pub fn unregister_cancel_hotkey(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut current = state
        .current_cancel_hotkey
        .lock()
        .map_err(|e| e.to_string())?;
    if let Some(prev) = current.take() {
        app.global_shortcut()
            .unregister(prev)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Parse-only validation of a cancel-hotkey combo. Used by Settings /
/// onboarding to surface a parse error before the user commits, without
/// actually registering the shortcut globally — registration is the
/// recording loop's job.
#[tauri::command]
pub fn validate_cancel_hotkey(combo: String) -> Result<String, String> {
    let shortcut = parse_combo_permissive(&combo).map_err(|e| e.to_string())?;
    Ok(format_combo(&shortcut))
}

/// Read `defaults read com.apple.HIToolbox AppleFnUsageType`.
/// Returns `None` when the key has never been set (factory default).
/// 0 = Do Nothing, 1 = Change Input Source, 2 = Show Emoji & Symbols, 3 = Start Dictation.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn get_fn_usage_type() -> Result<Option<i32>, String> {
    let output = std::process::Command::new("defaults")
        .args(["read", "com.apple.HIToolbox", "AppleFnUsageType"])
        .output()
        .map_err(|e| format!("defaults read failed to launch: {e}"))?;
    if !output.status.success() {
        // `defaults read` exits non-zero when the key isn't set yet.
        return Ok(None);
    }
    let s = String::from_utf8_lossy(&output.stdout);
    let trimmed = s.trim();
    let n = trimmed
        .parse::<i32>()
        .map_err(|e| format!("unexpected defaults output {trimmed:?}: {e}"))?;
    Ok(Some(n))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn get_fn_usage_type() -> Result<Option<i32>, String> {
    Err("Fn usage type is a macOS-only setting".into())
}

/// Write `defaults write com.apple.HIToolbox AppleFnUsageType -int <value>` and
/// `killall cfprefsd` so the change takes effect immediately without a logout.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn set_fn_usage_type(value: i32) -> Result<(), String> {
    let status = std::process::Command::new("defaults")
        .args([
            "write",
            "com.apple.HIToolbox",
            "AppleFnUsageType",
            "-int",
            &value.to_string(),
        ])
        .status()
        .map_err(|e| format!("defaults write failed to launch: {e}"))?;
    if !status.success() {
        return Err(format!(
            "defaults write exited with status {}",
            status.code().unwrap_or(-1)
        ));
    }
    // cfprefsd caches plists in-memory; without killing it the new value
    // is only picked up after the next logout.
    let _ = std::process::Command::new("killall")
        .arg("cfprefsd")
        .status();
    log::info!("AppleFnUsageType set to {value}");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn set_fn_usage_type(_value: i32) -> Result<(), String> {
    Err("Fn usage type is a macOS-only setting".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_platform_info_returns_current_os() {
        let info = get_platform_info();
        #[cfg(target_os = "macos")]
        assert_eq!(info.os, HostOs::Macos);
        #[cfg(target_os = "windows")]
        assert_eq!(info.os, HostOs::Windows);
        #[cfg(target_os = "linux")]
        assert_eq!(info.os, HostOs::Linux);
    }

    #[test]
    #[cfg(not(target_os = "linux"))]
    fn get_platform_info_is_never_wayland_off_linux() {
        assert!(!get_platform_info().is_wayland);
    }

    #[test]
    fn platform_info_serializes_camel_case() {
        // The JS side reads `info.isWayland`; serde's default would emit
        // `is_wayland`. This test pins the rename so a refactor that drops
        // the attribute fails loudly instead of silently breaking the
        // onboarding screen.
        let info = PlatformInfo {
            os: HostOs::Macos,
            is_wayland: false,
        };
        let j = serde_json::to_string(&info).unwrap();
        assert!(j.contains("\"isWayland\":false"), "got: {j}");
        assert!(j.contains("\"os\":\"macos\""), "got: {j}");
    }

    #[test]
    fn host_os_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&HostOs::Macos).unwrap(), "\"macos\"");
        assert_eq!(
            serde_json::to_string(&HostOs::Windows).unwrap(),
            "\"windows\""
        );
        assert_eq!(serde_json::to_string(&HostOs::Linux).unwrap(), "\"linux\"");
    }

    // ---- SettingsPanelKind: typed dispatch at the IPC boundary --------
    //
    // The `open_settings_panel` command used to take a `String` and dispatch
    // via `match s.as_str()`, so a typo from the JS side round-tripped as a
    // runtime `unknown panel: ...` error. With a `#[derive(Deserialize)]`
    // enum and `rename_all = "kebab-case"`, serde rejects invalid values at
    // deserialize time and the IPC layer returns a structured error instead.
    // These tests pin the three valid kebab-case spellings the JS side sends
    // (`'microphone' | 'accessibility' | 'input-monitoring'`) and verify
    // that anything else is refused.

    #[test]
    fn settings_panel_kind_deserializes_microphone() {
        let p: SettingsPanelKind = serde_json::from_str("\"microphone\"").unwrap();
        assert_eq!(p, SettingsPanelKind::Microphone);
    }

    #[test]
    fn settings_panel_kind_deserializes_accessibility() {
        let p: SettingsPanelKind = serde_json::from_str("\"accessibility\"").unwrap();
        assert_eq!(p, SettingsPanelKind::Accessibility);
    }

    #[test]
    fn settings_panel_kind_deserializes_input_monitoring_kebab() {
        // `rename_all = "kebab-case"` is what makes the JS-facing spelling
        // `"input-monitoring"` align with the Rust `InputMonitoring` variant.
        let p: SettingsPanelKind = serde_json::from_str("\"input-monitoring\"").unwrap();
        assert_eq!(p, SettingsPanelKind::InputMonitoring);
    }

    #[test]
    fn settings_panel_kind_rejects_unknown_value() {
        // The IPC payload `"unknown"` should fail at deserialize time — the
        // command handler must never see it as a `String` and dispatch a
        // runtime-string error.
        assert!(serde_json::from_str::<SettingsPanelKind>("\"unknown\"").is_err());
    }

    #[test]
    fn settings_panel_kind_rejects_snake_case_input_monitoring() {
        // Defensive: make sure snake_case doesn't accidentally pass through
        // — the kebab-case rename is the contract with the TS side.
        assert!(serde_json::from_str::<SettingsPanelKind>("\"input_monitoring\"").is_err());
    }

    // ---- parse_combo_input: typed dispatch for the Fn marker ----------
    //
    // `register_hotkey` still takes a `String` over IPC (JS contract
    // unchanged), but internally the dispatch now goes through the existing
    // `HotkeyCombo` enum rather than a bare string compare. These tests pin
    // the case-insensitive, whitespace-tolerant `"Fn"` marker and that
    // every other value parses as a `Standard { combo }`.

    #[test]
    fn parse_combo_input_recognises_fn_marker_exact() {
        assert_eq!(parse_combo_input("Fn").unwrap(), HotkeyCombo::Fn);
    }

    #[test]
    fn parse_combo_input_recognises_fn_marker_lowercase() {
        assert_eq!(parse_combo_input("fn").unwrap(), HotkeyCombo::Fn);
    }

    #[test]
    fn parse_combo_input_recognises_fn_marker_with_whitespace_and_caps() {
        assert_eq!(parse_combo_input(" FN ").unwrap(), HotkeyCombo::Fn);
    }

    #[test]
    fn parse_combo_input_treats_standard_combo_as_standard() {
        assert_eq!(
            parse_combo_input("Cmd+Shift+Space").unwrap(),
            HotkeyCombo::Standard {
                combo: "Cmd+Shift+Space".to_string(),
            },
        );
    }

    #[test]
    fn parse_combo_input_preserves_standard_combo_verbatim() {
        // We do NOT trim or normalise standard combos here — `parse_combo`
        // downstream handles whitespace. This pins the verbatim-passthrough
        // contract so a future refactor doesn't silently start trimming.
        assert_eq!(
            parse_combo_input(" Ctrl+Alt+A ").unwrap(),
            HotkeyCombo::Standard {
                combo: " Ctrl+Alt+A ".to_string(),
            },
        );
    }

    #[test]
    fn parse_combo_input_recognises_modifier_only_chord() {
        // Two-modifier chord like Cmd+Opt routes to the macOS chord
        // tap rather than `tauri-plugin-global-shortcut`.
        use crate::shortcut::parse::ModifierSet;
        let parsed = parse_combo_input("Cmd+Opt").unwrap();
        match parsed {
            HotkeyCombo::ModifiersOnly { mods } => {
                assert!(mods & ModifierSet::CMD != 0);
                assert!(mods & ModifierSet::ALT != 0);
                assert!(mods & ModifierSet::CTRL == 0);
                assert!(mods & ModifierSet::SHIFT == 0);
            }
            other => panic!("expected ModifiersOnly, got {other:?}"),
        }
    }

    #[test]
    fn parse_combo_input_recognises_double_tap() {
        use crate::shortcut::parse::ModifierSet;
        assert_eq!(
            parse_combo_input("DoubleTap+Cmd").unwrap(),
            HotkeyCombo::DoubleTap {
                modifier: ModifierSet::CMD,
            },
        );
    }

    #[test]
    fn parse_combo_input_single_modifier_falls_through_to_standard() {
        // A single bare modifier like "Cmd" is not a chord and not a
        // double-tap marker, so it should fall through to the standard
        // path (where `parse_combo` will reject it as `NoKey`).
        assert_eq!(
            parse_combo_input("Cmd").unwrap(),
            HotkeyCombo::Standard {
                combo: "Cmd".to_string(),
            },
        );
    }
}
