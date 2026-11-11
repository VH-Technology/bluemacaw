//! macOS Dock presence, independent of the always-available menu-bar tray.

use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::{Store, StoreExt};

// Native lifecycle code needs this before either webview loads SQLite.
const STORE_PATH: &str = "desktop-preferences.json";
const KEEP_IN_DOCK_KEY: &str = "keep_in_dock";

fn store<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<Store<R>>, String> {
    app.store_builder(STORE_PATH)
        .disable_auto_save()
        .build()
        .map_err(|e| e.to_string())
}

fn decode_preference(value: Option<Value>) -> bool {
    value.and_then(|v| v.as_bool()).unwrap_or(true)
}

pub fn get_keep_in_dock<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    Ok(decode_preference(store(app)?.get(KEEP_IN_DOCK_KEY)))
}

/// Save synchronously so a window close immediately after toggling sees the
/// new value, and a failed write never changes the effective preference.
pub fn set_keep_in_dock<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    let store = store(app)?;
    let previous = store.get(KEEP_IN_DOCK_KEY);
    store.set(KEEP_IN_DOCK_KEY, Value::Bool(enabled));
    if let Err(error) = store.save() {
        match previous {
            Some(value) => store.set(KEEP_IN_DOCK_KEY, value),
            None => {
                store.delete(KEEP_IN_DOCK_KEY);
            }
        }
        return Err(error.to_string());
    }
    Ok(())
}

#[cfg(any(target_os = "macos", test))]
fn show_in_dock(keep_in_dock: bool, main_window_visible: bool) -> bool {
    main_window_visible || keep_in_dock
}

/// Only the main window counts. Presenting the recording overlay must not
/// bring the Dock icon back for someone using menu-bar-only mode.
pub fn apply_for_main_visibility<R: Runtime>(app: &AppHandle<R>, main_window_visible: bool) {
    #[cfg(target_os = "macos")]
    {
        let keep_in_dock = get_keep_in_dock(app).unwrap_or_else(|error| {
            log::warn!("reading Dock preference failed: {error}");
            true
        });
        let policy = if show_in_dock(keep_in_dock, main_window_visible) {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        if let Err(error) = app.set_activation_policy(policy) {
            log::warn!("applying Dock preference failed: {error}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, main_window_visible);
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        apply_for_main_visibility(app, true);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_or_invalid_preference_preserves_existing_dock_behavior() {
        assert!(decode_preference(None));
        assert!(decode_preference(Some(json!(null))));
        assert!(decode_preference(Some(json!("false"))));
        assert!(decode_preference(Some(json!(true))));
        assert!(!decode_preference(Some(json!(false))));
    }

    #[test]
    fn closing_or_login_launch_obeys_preference_and_reopening_restores_dock() {
        for keep_in_dock in [false, true] {
            assert!(show_in_dock(keep_in_dock, true), "open main window");
            assert_eq!(
                show_in_dock(keep_in_dock, false),
                keep_in_dock,
                "closed main window / login launch"
            );
            assert!(
                show_in_dock(keep_in_dock, true),
                "reopened from tray or Dock"
            );
        }
    }
}
