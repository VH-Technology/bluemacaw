//! Windows: mark the overlay window as non-activating.
//!
//! By default, `ShowWindow(SW_SHOW)` (what Tauri's `window.show()` calls on
//! Windows) activates the window — it comes to the foreground and steals
//! keyboard focus from whatever app the user was typing into. That breaks
//! the dictation flow: focus should stay in the target app so `paste_text`'s
//! `Ctrl+V` lands where the user intended.
//!
//! The fix is `WS_EX_NOACTIVATE`: an extended window style that tells
//! Windows "never activate this window, whether it's shown programmatically
//! or clicked by the user." It's the Windows equivalent of what
//! `NSWindowStyleMaskNonactivatingPanel` + `becomesKeyOnlyIfNeeded` achieve
//! on macOS via `overlay_panel.rs`.
//!
//! * Mouse clicks are still delivered to the webview (Stop button, drag
//!   handle, Cancel button all work).
//! * The owning app is **not** brought to the foreground.
//! * The target app keeps focus.
//!
//! We set this once during app startup so every subsequent `show()` —
//! including Tauri's own `show()` in `present_overlay` — respects it.

#![cfg(target_os = "windows")]

use tauri::{Runtime, WebviewWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
};

/// Apply `WS_EX_NOACTIVATE` to the overlay window so it never steals focus.
///
/// Called once during app startup (in `lib.rs::setup`), right after the
/// macOS panel conversion. On Windows the `transparent: true` and
/// `alwaysOnTop: true` config options already configure the window correctly;
/// this one additional style flag is the only missing piece.
pub fn make_overlay_nonactivating<R: Runtime>(
    window: &WebviewWindow<R>,
) -> tauri::Result<()> {
    // Tauri 2's hwnd() returns an isize on Windows. We cast it to HWND
    // (*mut c_void) via the intermediate usize so the windows crate can
    // treat it as a typed handle.
    let hwnd = window.hwnd()?;
    // hwnd() returns isize; windows crate expects *mut c_void.
    let hwnd = windows::Win32::Foundation::HWND(hwnd as *mut std::ffi::c_void);

    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_ex_style = ex_style | (WS_EX_NOACTIVATE.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex_style);
    }

    log::info!("overlay_win: overlay marked as non-activating");
    Ok(())
}
