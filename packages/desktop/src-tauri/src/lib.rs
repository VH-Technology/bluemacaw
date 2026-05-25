pub mod audio;
pub mod clipboard;
pub mod commands;
pub mod history;
pub mod markers;
#[cfg(target_os = "macos")]
pub mod overlay_panel;
pub mod paste;
pub mod platform;
pub mod secrets;
pub mod shortcut;
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
            // No CLI args needed on relaunch; bluemacaw boots the same
            // tray-resident process whether the user clicked the dock
            // icon or the OS auto-launched it.
            None,
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_websocket::init())
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
            commands::present_overlay,
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
                #[cfg(target_os = "macos")]
                fn_tap: Mutex::new(None),
                #[cfg(target_os = "macos")]
                chord_tap: Mutex::new(None),
            };
            app.manage(app_state);

            tray::build(app.handle())?;

            // macOS: convert the overlay window to a non-activating NSPanel
            // so clicks on the Stop button / drag handle don't yank focus
            // away from whatever app the user is dictating into.
            #[cfg(target_os = "macos")]
            if let Some(overlay_window) = app.get_webview_window("overlay") {
                if let Err(e) = overlay_panel::make_overlay_nonactivating(&overlay_window) {
                    log::warn!("overlay panel conversion failed: {e}");
                }
            }

            // Tray-resident behaviour: closing the main window hides it and
            // (on macOS) hides the Dock icon, instead of quitting the app.
            // Re-open via the tray "Open bluemacaw" item, which reverses this.
            if let Some(main_window) = app.get_webview_window("main") {
                let main_window_for_close = main_window.clone();
                let app_handle = app.handle().clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_window_for_close.hide();
                        #[cfg(target_os = "macos")]
                        {
                            let _ = app_handle
                                .set_activation_policy(tauri::ActivationPolicy::Accessory);
                        }
                        // Reference app_handle on non-macOS too so the closure
                        // doesn't drop it as unused.
                        #[cfg(not(target_os = "macos"))]
                        let _ = &app_handle;
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running bluemacaw");
}
