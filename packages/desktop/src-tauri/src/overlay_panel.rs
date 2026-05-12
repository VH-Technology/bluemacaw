//! macOS-only: convert the overlay window into a non-activating `NSPanel`.
//!
//! By default, every Cocoa window activates the owning app on click. That's
//! catastrophic for a recording overlay: clicking the Stop button or drag
//! handle would yank focus away from whatever the user was typing into,
//! breaking the paste-into-active-app flow.
//!
//! The fix is the standard macOS pattern used by Wispr Flow, Raycast, Alfred,
//! Spotlight, and macOS's own Now Playing widget: change the window's class
//! to `NSPanel` and set `NSWindowStyleMaskNonactivatingPanel`. After this:
//!
//! * Clicks are still delivered to the webview.
//! * The owning app is **not** brought to the foreground.
//! * Whatever app the user was using stays focused.
//! * `paste_text`'s `Cmd+V` keystroke lands where the user actually wanted.
//!
//! Tauri 2 has no high-level API for this, so we drop down to the AppKit
//! private API surface via `objc2-app-kit`. We only do this on macOS.

#![cfg(target_os = "macos")]

use objc2::msg_send;
use objc2::runtime::AnyObject;
use objc2::ClassType;
use objc2_app_kit::{
    NSPanel, NSWindowCollectionBehavior, NSWindowLevel, NSWindowStyleMask,
};
use tauri::{Runtime, WebviewWindow};

// NSFloatingWindowLevel constant (kCGFloatingWindowLevel == 3 in legacy
// Cocoa headers; Apple's runtime uses the same number via NSWindow.Level).
const NS_FLOATING_WINDOW_LEVEL: NSWindowLevel = 3;

/// Convert a Tauri-created `NSWindow` into a non-activating `NSPanel`.
///
/// Steps:
/// 1. Grab the underlying `NSWindow` pointer from the Tauri webview window.
/// 2. Re-class it to `NSPanel` (`object_setClass`). `NSPanel` is a subclass of
///    `NSWindow` with the same memory layout, so this is a safe runtime swap
///    once the styleMask has been set up to be panel-compatible.
/// 3. Set `styleMask` to include `NSWindowStyleMaskNonactivatingPanel`. This
///    flag is what tells AppKit "deliver clicks but don't activate the app."
/// 4. Set `level` to floating so we stay above normal windows.
/// 5. Set `hidesOnDeactivate = false` so we remain visible when the user
///    switches focus to another app (which will be the common case).
/// 6. Set `collectionBehavior` to keep the panel visible across desktop
///    spaces and in fullscreen contexts.
pub fn make_overlay_nonactivating<R: Runtime>(
    window: &WebviewWindow<R>,
) -> tauri::Result<()> {
    let raw_ns_window = window.ns_window()?;
    if raw_ns_window.is_null() {
        log::warn!("overlay_panel: ns_window() returned null; skipping panel conversion");
        return Ok(());
    }

    // We promise to drop the Retained without ever calling -release on the
    // webview's NSWindow (we don't own a +1 reference here — Tauri keeps it
    // alive). The Retained acts purely as a typed handle; we leak it via
    // `into_inner` semantics by avoiding extra retain/release.
    //
    // Concretely: we cast the raw pointer to `*mut AnyObject`, send messages,
    // and never deallocate.
    let any_obj: *mut AnyObject = raw_ns_window.cast();

    unsafe {
        // 1+2. Re-class to NSPanel via the ObjC runtime's object_setClass.
        //      NSObject does not expose a `setClass:` selector, so going
        //      through `msg_send!` would crash with unrecognized-selector.
        //      `AnyObject::set_class` is objc2's safe wrapper around
        //      `object_setClass`. After this call the same memory is
        //      treated as an NSPanel by the runtime, which is valid because
        //      NSPanel inherits NSWindow with the same layout.
        let obj_ref: &AnyObject = &*any_obj;
        let _ = AnyObject::set_class(obj_ref, NSPanel::class());

        // 3. Add nonactivating-panel to the existing mask.
        let current_mask: NSWindowStyleMask = msg_send![any_obj, styleMask];
        let new_mask = current_mask | NSWindowStyleMask::NonactivatingPanel;
        let _: () = msg_send![any_obj, setStyleMask: new_mask];

        // 4. Float above normal app windows. Tauri's alwaysOnTop config
        //    already gets us close; we set the level explicitly so the
        //    class swap doesn't reset it.
        let _: () = msg_send![any_obj, setLevel: NS_FLOATING_WINDOW_LEVEL];

        // 5. Don't hide when the user switches apps.
        let _: () = msg_send![any_obj, setHidesOnDeactivate: false];

        // 6. Stay visible across spaces and in fullscreen contexts.
        let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary;
        let _: () = msg_send![any_obj, setCollectionBehavior: behavior];

        // 7. Don't grab keyboard focus on click. `becomesKeyOnlyIfNeeded` is
        //    an NSPanel-only property and only takes effect now that we've
        //    re-classed.
        let _: () = msg_send![any_obj, setBecomesKeyOnlyIfNeeded: true];

        // 8. Force a transparent backing surface AFTER the class swap.
        //    Tauri's `transparent: true` config wires this up for the
        //    NSWindow Tauri creates, but NSPanel has different default
        //    chrome and the appearance can re-emerge once the runtime
        //    starts treating the object as a panel — surfacing as a
        //    dark rounded band below the pill where the floating overlay
        //    pill doesn't cover the window. Setting `isOpaque = NO` and
        //    `backgroundColor = [NSColor clearColor]` explicitly here
        //    pins the panel to clear-backing regardless of what defaults
        //    AppKit would otherwise apply.
        let _: () = msg_send![any_obj, setOpaque: false];
        let color_class = objc2::class!(NSColor);
        let clear_color: *mut AnyObject = msg_send![color_class, clearColor];
        let _: () = msg_send![any_obj, setBackgroundColor: clear_color];
    }

    log::info!("overlay_panel: overlay converted to non-activating NSPanel");
    Ok(())
}
