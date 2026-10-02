pub mod apple_intelligence;
pub mod audio;
pub mod clipboard;
pub mod commands;
pub mod history;
pub mod login_launch;
pub mod markers;
#[cfg(target_os = "macos")]
pub mod overlay_panel;
pub mod paste;
pub mod platform;
pub mod secrets;
pub mod shortcut;
pub mod system_volume;
pub mod local_model;
pub mod tray;

use std::sync::{Arc, Mutex};

use audio::microphone::MicrophoneSource;
use clipboard::TauriClipboard;
use commands::AppState;
use paste::EnigoPaster;
use secrets::keyring_vault::KeyringVault;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Default to info-level logs in dev builds so Fn-tap diagnostics, paste
    // errors, etc. surface in the terminal without setting RUST_LOG.
    // Production builds stay quiet unless RUST_LOG is set.
    #[cfg(debug_assertions)]
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info"),
    )
    .init();
    #[cfg(not(debug_assertions))]
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            // `AppleScript` registers a Login Item via osascript on macOS.
            // The alternative (`LaunchAgent`) writes a plist to
            // ~/Library/LaunchAgents which survives app uninstall — the
            // Login Item path is cleaner and matches what the user sees
            // in System Settings → General → Login Items.
            tauri_plugin_autostart::MacosLauncher::AppleScript,
            // Windows and Linux forward this flag to the auto-launched
            // process, which then keeps the main window hidden (see
            // `login_launch`). A macOS Login Item cannot carry arguments;
            // there the launch is recognised by its timing instead.
            Some(vec![login_launch::AUTOSTART_FLAG]),
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(history::DB_URL, history::migrations())
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::check_microphone_permission,
            commands::request_microphone_permission,
            commands::check_accessibility_permission,
            commands::check_accessibility_permission_prompting,
            commands::request_accessibility_permission,
            commands::check_input_monitoring_permission,
            commands::request_input_monitoring_permission,
            commands::open_settings_panel,
            commands::start_recording,
            commands::start_recording_realtime,
            commands::stop_recording,
            commands::cancel_recording,
            commands::get_recording_level,
            commands::get_secret,
            commands::set_secret,
            commands::delete_secret,
            commands::list_audio_input_devices,
            commands::paste_text,
            commands::register_hotkey,
            commands::unregister_hotkey,
            commands::register_cancel_hotkey,
            commands::unregister_cancel_hotkey,
            commands::validate_cancel_hotkey,
            commands::get_fn_usage_type,
            commands::set_fn_usage_type,
            commands::get_platform_info,
            commands::restart_app,
            commands::download_whisper_model,
            commands::cancel_model_download,
            commands::transcribe_local,
            commands::list_local_models,
            commands::delete_local_model,
            commands::get_apple_intelligence_status,
            commands::generate_with_apple_intelligence,
            commands::present_overlay,
            commands::duck_system_volume,
            commands::restore_system_volume,
        ])
        .setup(|app| {
            log::info!("bluemacaw setup: building AppState with TauriClipboard");
            let clipboard = Arc::new(TauriClipboard::new(app.handle().clone()));
            let app_state = AppState {
                audio: Box::new(MicrophoneSource::new()),
                vault: Box::new(KeyringVault::new()),
                // `Arc` so the async `paste_text` command can clone the paster
                // into a `spawn_blocking` task without an extra trait surface.
                paster: Arc::new(EnigoPaster::new(clipboard)),
                current_hotkey: Mutex::new(None),
                current_cancel_hotkey: Mutex::new(None),
                saved_volume: Mutex::new(None),
                #[cfg(target_os = "macos")]
                fn_tap: Mutex::new(None),
                #[cfg(target_os = "macos")]
                chord_tap: Mutex::new(None),
                download_cancel_tokens: std::sync::Mutex::new(
                    std::collections::HashMap::new(),
                ),
            };
            app.manage(app_state);

            tray::build(app.handle())?;

            // Autostart entries written before `--autostart` existed lack the
            // flag, so rewrite an enabled entry on every start. Skipped on
            // macOS: the Login Item carries no arguments, and re-adding it
            // could duplicate the entry.
            #[cfg(not(target_os = "macos"))]
            {
                use tauri_plugin_autostart::ManagerExt;
                let autostart = app.autolaunch();
                if autostart.is_enabled().unwrap_or(false) {
                    if let Err(e) = autostart.enable() {
                        log::warn!("refreshing the autostart entry failed: {e}");
                    }
                }
            }

            // macOS: convert the overlay window to a non-activating NSPanel
            // so clicks on the Stop button / drag handle don't yank focus
            // away from whatever app the user is dictating into.
            #[cfg(target_os = "macos")]
            if let Some(overlay_window) = app.get_webview_window("overlay") {
                if let Err(e) = overlay_panel::make_overlay_nonactivating(&overlay_window) {
                    log::warn!("overlay panel conversion failed: {e}");
                }
            }

            // Closing the main window hides it instead of quitting — the app
            // keeps running (tray + global hotkey stay live). We deliberately
            // keep the activation policy at `Regular` so the Dock icon stays
            // put; clicking it re-opens the window via the `Reopen` handler
            // below, just like the tray's "Open bluemacaw". Quitting (tray
            // Quit / Cmd+Q) still exits the process.
            if let Some(main_window) = app.get_webview_window("main") {
                // The main window is created hidden (`visible: false` in
                // tauri.conf.json). A launch at login stays in the tray; every
                // other launch shows the window right away. The webview shows
                // it itself when onboarding is still pending (`MainWindow`).
                if !login_launch::launched_at_login() {
                    let _ = main_window.show();
                    let _ = main_window.set_focus();
                }

                let main_window_for_close = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_window_for_close.hide();
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building bluemacaw")
        .run(|_app_handle, _event| {
            // macOS: clicking the Dock icon while the window is hidden fires
            // a Reopen event (the app stays Dock-resident because we never
            // drop to Accessory). Re-show + focus the main window, mirroring
            // the tray's "Open bluemacaw".
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                if let Some(window) = _app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
