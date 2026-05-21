#![cfg(target_os = "macos")]

//! macOS Fn-key shortcut backend.
//!
//! `tauri-plugin-global-shortcut` cannot observe the secondary-fn
//! modifier, so the Fn key is wired through a `CGEventTap` listening
//! on `kCGEventTypeFlagsChanged`. `CGEventTap` gates on the
//! **Input Monitoring** TCC bucket (`kTCCServiceListenEvent`) — NOT
//! Accessibility. The classic mistake (and one this codebase made in
//! earlier revisions) is to surface a missing tap as
//! `AccessibilityRequired`; granting Accessibility alone does not fix
//! the Fn tap. We surface this as
//! [`ShortcutError::InputMonitoringRequired`].
//!
//! Compare with `CGEventPost` (used by the paste path via `enigo`),
//! which *does* gate on Accessibility — a different TCC bucket
//! (`kTCCServiceAccessibility`). Listen and post are two separate
//! permissions even though both relate to keyboard events.
//!
//! Spec reference: §6.10.

use super::{HotkeyCombo, ShortcutError, ShortcutManager};
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_graphics::event::{
    CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
    CGEventType,
};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

/// `kCGEventFlagMaskSecondaryFn` — set when the macOS Fn key is held.
///
/// Stable across macOS versions; mirrors `NSEventModifierFlagFunction`.
const FN_FLAG_MASK: u64 = CGEventFlags::CGEventFlagSecondaryFn.bits();

pub struct MacOsFnTap {
    on_toggle: Arc<dyn Fn() + Send + Sync + 'static>,
    state: Arc<Mutex<TapState>>,
}

struct TapState {
    thread: Option<JoinHandle<()>>,
}

impl MacOsFnTap {
    pub fn new<F: Fn() + Send + Sync + 'static>(on_toggle: F) -> Self {
        Self {
            on_toggle: Arc::new(on_toggle),
            state: Arc::new(Mutex::new(TapState { thread: None })),
        }
    }

    fn start(&self) -> Result<(), ShortcutError> {
        if self.state.lock().unwrap().thread.is_some() {
            // Already running; treat as idempotent register.
            return Ok(());
        }

        let on_toggle = self.on_toggle.clone();
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), ShortcutError>>();

        let handle = thread::spawn(move || {
            // Per-thread Fn-state tracker so we only fire on the
            // press edge, not on release.
            let prev = Arc::new(Mutex::new(false));
            let prev_for_cb = prev.clone();
            let on_toggle_for_cb = on_toggle.clone();

            log::info!("Fn tap: creating CGEventTap for FlagsChanged events");
            let tap_result = CGEventTap::new(
                CGEventTapLocation::HID,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::ListenOnly,
                vec![CGEventType::FlagsChanged],
                move |_proxy, _etype, event| {
                    let raw_flags = event.get_flags().bits();
                    let fn_pressed = (raw_flags & FN_FLAG_MASK) != 0;
                    // Trace every FlagsChanged we observe so we can
                    // distinguish "tap never fires" from "tap fires but Fn
                    // bit isn't set" (the latter means the system mapped
                    // Fn to language-switch or similar — see System
                    // Settings → Keyboard → "Press 🌐 key to:").
                    log::debug!(
                        "Fn tap event: raw_flags=0x{raw_flags:x} fn_pressed={fn_pressed}"
                    );
                    let mut last = prev_for_cb.lock().unwrap();
                    if fn_pressed != *last {
                        *last = fn_pressed;
                        if fn_pressed {
                            log::info!("Fn key pressed — firing toggle");
                            (on_toggle_for_cb)();
                        } else {
                            log::debug!("Fn key released");
                        }
                    }
                    // ListenOnly tap: returning Some passes through
                    // unchanged. We never want to consume the event.
                    None
                },
            );

            match tap_result {
                Ok(tap) => {
                    let loop_source = match tap.mach_port.create_runloop_source(0) {
                        Ok(src) => src,
                        Err(()) => {
                            let _ = tx.send(Err(ShortcutError::Backend(
                                "failed to create CFRunLoopSource for CGEventTap".into(),
                            )));
                            return;
                        }
                    };
                    let current = CFRunLoop::get_current();
                    current.add_source(&loop_source, unsafe { kCFRunLoopCommonModes });
                    tap.enable();
                    log::info!("Fn tap: enabled, waiting for FlagsChanged events");
                    let _ = tx.send(Ok(()));
                    // Blocks the spawned thread for the rest of the
                    // app lifetime. `unregister` is a no-op in v1
                    // (see trait impl below).
                    CFRunLoop::run_current();
                }
                Err(()) => {
                    // `CGEventTap::new` returns Err(()) when the kernel
                    // refuses to install the tap. In practice on macOS the
                    // overwhelming cause is missing Input Monitoring
                    // (`kTCCServiceListenEvent`) — not Accessibility.
                    log::error!(
                        "CGEventTap creation returned null — Input Monitoring \
                         permission almost certainly missing \
                         (kTCCServiceListenEvent; NOT Accessibility)"
                    );
                    let _ = tx.send(Err(ShortcutError::InputMonitoringRequired));
                }
            }
        });

        // Wait for the tap thread to confirm setup before returning.
        let setup = rx
            .recv()
            .map_err(|_| ShortcutError::Backend("tap thread terminated before setup".into()))?;
        setup?;

        self.state.lock().unwrap().thread = Some(handle);
        Ok(())
    }
}

impl ShortcutManager for MacOsFnTap {
    fn register(&self, combo: HotkeyCombo) -> Result<(), ShortcutError> {
        match combo {
            HotkeyCombo::Fn => self.start(),
            HotkeyCombo::Standard { .. }
            | HotkeyCombo::ModifiersOnly { .. }
            | HotkeyCombo::DoubleTap { .. } => Err(ShortcutError::Backend(
                "MacOsFnTap only supports Fn combos".into(),
            )),
        }
    }

    fn unregister(&self) -> Result<(), ShortcutError> {
        // The tap thread owns its run loop; in production we'd send
        // a stop signal via `CFRunLoop::stop`. For v1 the tap
        // survives the app lifetime.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fn_flag_mask_matches_secondary_fn_constant() {
        // Sanity check: the spec hard-codes 0x800000 as the
        // `kCGEventFlagMaskSecondaryFn` value. Confirm the
        // bitflags constant agrees.
        assert_eq!(FN_FLAG_MASK, 0x0080_0000);
    }

    #[test]
    fn standard_combo_is_rejected() {
        let tap = MacOsFnTap::new(|| {});
        let err = tap
            .register(HotkeyCombo::Standard {
                combo: "Ctrl+Shift+Space".into(),
            })
            .unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("MacOsFnTap only supports Fn combos"), "got: {msg}");
    }

    #[test]
    fn unregister_is_noop_when_not_started() {
        let tap = MacOsFnTap::new(|| {});
        tap.unregister().unwrap();
    }

    #[test]
    fn macos_fn_tap_implements_send_and_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<MacOsFnTap>();
    }
}
