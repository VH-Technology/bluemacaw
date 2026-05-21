#![cfg(target_os = "macos")]

//! macOS modifier-chord shortcut backend.
//!
//! Covers two related shortcut surfaces that `tauri-plugin-global-shortcut`
//! cannot express because its `RegisterHotKey`/`global-hotkey`
//! foundation requires every binding to terminate in a non-modifier
//! key:
//!
//! * **Modifier-only chord** — e.g. Cmd+Opt held together with no
//!   other key. Fires once on the press edge when the exact
//!   modifier set becomes held; the chord is "armed" again once any
//!   of those modifiers is released, so holding indefinitely yields
//!   exactly one event per press.
//! * **Double-tap modifier** — e.g. tap Cmd twice within ~350ms.
//!   The tap tracks the press/release sequence of a single modifier
//!   and fires when it sees `down → up → down` inside the window
//!   without any other modifier or non-modifier key intervening.
//!
//! Both surfaces share the same `CGEventTap` plumbing as
//! [`super::macos_fn::MacOsFnTap`] — the tap gates on the **Input
//! Monitoring** TCC bucket (`kTCCServiceListenEvent`), surfaced as
//! [`super::ShortcutError::InputMonitoringRequired`] when the kernel
//! refuses to install it.
//!
//! The chord tap also subscribes to `KeyDown` events so it can
//! invalidate the in-flight chord/double-tap state when the user
//! presses an additional non-modifier key (Cmd+S during a Cmd+Opt
//! chord, for example).

use super::parse::ModifierSet;
use super::{HotkeyCombo, ShortcutError, ShortcutManager};
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_graphics::event::{
    CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
    CGEventType,
};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// CGEventFlags for each macOS modifier bit, mirrored from
/// `kCGEventFlagMask*`. Stable across macOS versions.
const FLAG_CMD: u64 = CGEventFlags::CGEventFlagCommand.bits();
const FLAG_SHIFT: u64 = CGEventFlags::CGEventFlagShift.bits();
const FLAG_ALT: u64 = CGEventFlags::CGEventFlagAlternate.bits();
const FLAG_CTRL: u64 = CGEventFlags::CGEventFlagControl.bits();

/// Window inside which a press-release-press sequence still counts as
/// a double-tap. Matches the macOS dictation gesture's tolerance.
const DOUBLE_TAP_WINDOW: Duration = Duration::from_millis(350);

#[derive(Debug, Clone, Copy)]
enum ChordMode {
    /// Fire when the exact modifier set becomes held, exactly once
    /// until any of those modifiers is released.
    ModifiersOnly { mods: u8 },
    /// Fire on the second press of the named modifier when it occurs
    /// inside [`DOUBLE_TAP_WINDOW`] of the first release.
    DoubleTap { modifier: u8 },
}

pub struct MacOsChordTap {
    on_toggle: Arc<dyn Fn() + Send + Sync + 'static>,
    mode: ChordMode,
    state: Arc<Mutex<TapState>>,
}

// Manual `Debug` impl because the `on_toggle` callback is a trait
// object that can't derive `Debug`. The tests `unwrap_err()` a
// `Result<MacOsChordTap, _>`, which requires the Ok variant to be
// `Debug`; skipping the callback in the output is harmless.
impl std::fmt::Debug for MacOsChordTap {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MacOsChordTap")
            .field("mode", &self.mode)
            .field("on_toggle", &"<callback>")
            .finish()
    }
}

struct TapState {
    thread: Option<JoinHandle<()>>,
}

impl MacOsChordTap {
    pub fn new<F: Fn() + Send + Sync + 'static>(on_toggle: F, mode_combo: &HotkeyCombo) -> Result<Self, ShortcutError> {
        let mode = match mode_combo {
            HotkeyCombo::ModifiersOnly { mods } => ChordMode::ModifiersOnly { mods: *mods },
            HotkeyCombo::DoubleTap { modifier } => ChordMode::DoubleTap { modifier: *modifier },
            _ => {
                return Err(ShortcutError::Backend(
                    "MacOsChordTap only handles ModifiersOnly / DoubleTap combos".into(),
                ));
            }
        };
        Ok(Self {
            on_toggle: Arc::new(on_toggle),
            mode,
            state: Arc::new(Mutex::new(TapState { thread: None })),
        })
    }

    fn start(&self) -> Result<(), ShortcutError> {
        if self.state.lock().unwrap().thread.is_some() {
            return Ok(());
        }
        let on_toggle = self.on_toggle.clone();
        let mode = self.mode;
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), ShortcutError>>();

        let handle = thread::spawn(move || {
            // Mutable per-tap state: the chord arm flag for the
            // modifier-only path, and the press/release timestamps
            // for the double-tap path.
            let arm = Arc::new(Mutex::new(ChordRuntime::new()));
            let arm_for_cb = arm.clone();
            let on_toggle_for_cb = on_toggle.clone();

            log::info!("chord tap: creating CGEventTap (mode={mode:?})");
            let tap_result = CGEventTap::new(
                CGEventTapLocation::HID,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::ListenOnly,
                vec![CGEventType::FlagsChanged, CGEventType::KeyDown],
                move |_proxy, etype, event| {
                    let flags = event.get_flags().bits();
                    let mut runtime = arm_for_cb.lock().unwrap();
                    match etype {
                        CGEventType::FlagsChanged => {
                            handle_flags_changed(
                                &mut runtime,
                                mode,
                                flags,
                                on_toggle_for_cb.as_ref(),
                            );
                        }
                        CGEventType::KeyDown => {
                            // Any non-modifier press resets the chord
                            // detection so a Cmd+Opt+S chord doesn't
                            // also fire the Cmd+Opt modifier-only
                            // chord, and a Cmd+S keypress doesn't get
                            // misread as the second tap of a Cmd
                            // double-tap.
                            runtime.invalidate();
                        }
                        _ => {}
                    }
                    None
                },
            );

            match tap_result {
                Ok(tap) => {
                    let loop_source = match tap.mach_port.create_runloop_source(0) {
                        Ok(src) => src,
                        Err(()) => {
                            let _ = tx.send(Err(ShortcutError::Backend(
                                "failed to create CFRunLoopSource for chord CGEventTap".into(),
                            )));
                            return;
                        }
                    };
                    let current = CFRunLoop::get_current();
                    current.add_source(&loop_source, unsafe { kCFRunLoopCommonModes });
                    tap.enable();
                    log::info!("chord tap: enabled");
                    let _ = tx.send(Ok(()));
                    CFRunLoop::run_current();
                }
                Err(()) => {
                    log::error!(
                        "chord CGEventTap creation returned null — Input Monitoring permission \
                         almost certainly missing (kTCCServiceListenEvent)"
                    );
                    let _ = tx.send(Err(ShortcutError::InputMonitoringRequired));
                }
            }
        });

        let setup = rx
            .recv()
            .map_err(|_| ShortcutError::Backend("chord tap thread terminated before setup".into()))?;
        setup?;
        self.state.lock().unwrap().thread = Some(handle);
        Ok(())
    }
}

impl ShortcutManager for MacOsChordTap {
    fn register(&self, combo: HotkeyCombo) -> Result<(), ShortcutError> {
        match combo {
            HotkeyCombo::ModifiersOnly { mods } => match self.mode {
                ChordMode::ModifiersOnly { mods: m } if m == mods => self.start(),
                _ => Err(ShortcutError::Backend(
                    "chord tap was constructed for a different mode".into(),
                )),
            },
            HotkeyCombo::DoubleTap { modifier } => match self.mode {
                ChordMode::DoubleTap { modifier: m } if m == modifier => self.start(),
                _ => Err(ShortcutError::Backend(
                    "chord tap was constructed for a different mode".into(),
                )),
            },
            _ => Err(ShortcutError::Backend(
                "MacOsChordTap only handles ModifiersOnly / DoubleTap combos".into(),
            )),
        }
    }

    fn unregister(&self) -> Result<(), ShortcutError> {
        // Same v1 caveat as `MacOsFnTap`: the tap thread owns its run
        // loop and we can't cleanly stop a CFRunLoop in v1. Switching
        // shortcuts unregisters the binding from the JS side; the tap
        // stays alive and dormant until process exit.
        Ok(())
    }
}

/// Tap-thread-local mutable state.
struct ChordRuntime {
    /// For ModifiersOnly: true once we've fired for the current
    /// "all required mods held" episode. Reset when any required mod
    /// is released.
    chord_armed: bool,
    /// For DoubleTap: timestamp of the most recent clean release of
    /// the tracked modifier. `None` until we've seen at least one
    /// complete press-release pair.
    last_release: Option<Instant>,
    /// For DoubleTap: was the modifier "exactly held alone" on the
    /// previous flags snapshot? Used to detect press/release edges.
    last_held: bool,
    /// Set when the in-flight chord/double-tap sequence has been
    /// invalidated (non-modifier KeyDown, or a non-target modifier
    /// got mixed in). Cleared only when the user returns to "nothing
    /// held".
    poisoned: bool,
}

impl ChordRuntime {
    fn new() -> Self {
        Self {
            chord_armed: false,
            last_release: None,
            last_held: false,
            poisoned: false,
        }
    }
    fn invalidate(&mut self) {
        // Mark the chord as already-fired so a held chord doesn't
        // immediately refire after a non-modifier KeyDown rejoins
        // the same modifier set.
        self.chord_armed = true;
        self.poisoned = true;
        self.last_release = None;
    }
}

fn flags_to_modifier_set(flags: u64) -> u8 {
    let mut out = 0u8;
    if (flags & FLAG_CMD) != 0 {
        out |= ModifierSet::CMD;
    }
    if (flags & FLAG_CTRL) != 0 {
        out |= ModifierSet::CTRL;
    }
    if (flags & FLAG_ALT) != 0 {
        out |= ModifierSet::ALT;
    }
    if (flags & FLAG_SHIFT) != 0 {
        out |= ModifierSet::SHIFT;
    }
    out
}

fn handle_flags_changed<F>(
    runtime: &mut ChordRuntime,
    mode: ChordMode,
    flags: u64,
    on_toggle: &F,
) where
    F: Fn() + ?Sized,
{
    let current = flags_to_modifier_set(flags);
    match mode {
        ChordMode::ModifiersOnly { mods } => {
            let exact_match = current == mods;
            if exact_match && !runtime.chord_armed {
                runtime.chord_armed = true;
                log::info!("chord tap: modifier-only chord fired (mods=0x{mods:x})");
                on_toggle();
            }
            // Disarm when ANY required modifier is released, so the
            // next time the user assembles the full set we fire
            // again.
            if !exact_match && (current & mods) != mods {
                runtime.chord_armed = false;
            }
        }
        ChordMode::DoubleTap { modifier } => {
            let exactly_target = current == modifier;
            let press = exactly_target && !runtime.last_held;
            let release = runtime.last_held && !exactly_target;

            // Poison the in-flight pair when any modifier state
            // includes something OTHER than the target alone — e.g.
            // Cmd+Shift. Prevents "Cmd → Cmd+Shift → Cmd → Cmd" from
            // being misread as a Cmd double-tap.
            if current != 0 && current != modifier {
                runtime.poisoned = true;
                runtime.last_release = None;
            }

            if press && !runtime.poisoned {
                if let Some(last) = runtime.last_release {
                    if last.elapsed() <= DOUBLE_TAP_WINDOW {
                        log::info!(
                            "chord tap: double-tap fired (modifier=0x{modifier:x})"
                        );
                        on_toggle();
                        runtime.last_release = None;
                        runtime.last_held = exactly_target;
                        return;
                    }
                }
                // First press of a new pair or a stale prior release
                // beyond the window — reset the candidate timestamp
                // so the *next* clean release seeds the pair.
                runtime.last_release = None;
            }

            if release {
                // Only a clean release (everything off) is a valid
                // candidate for the "first tap" of a future pair.
                if !runtime.poisoned && current == 0 {
                    runtime.last_release = Some(Instant::now());
                } else {
                    runtime.last_release = None;
                }
            }

            // Clear poison only when the user has fully let go of
            // everything — this keeps a corrupted sequence corrupted
            // until they restart with a clean slate.
            if current == 0 {
                runtime.poisoned = false;
            }

            runtime.last_held = exactly_target;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flag_constants_align_with_cgevent_constants() {
        // Sanity: the bit values we hard-code match what the
        // core-graphics crate exposes.
        assert_eq!(FLAG_CMD, CGEventFlags::CGEventFlagCommand.bits());
        assert_eq!(FLAG_SHIFT, CGEventFlags::CGEventFlagShift.bits());
        assert_eq!(FLAG_ALT, CGEventFlags::CGEventFlagAlternate.bits());
        assert_eq!(FLAG_CTRL, CGEventFlags::CGEventFlagControl.bits());
    }

    #[test]
    fn flags_to_modifier_set_maps_each_bit() {
        assert_eq!(flags_to_modifier_set(0), 0);
        assert_eq!(flags_to_modifier_set(FLAG_CMD), ModifierSet::CMD);
        assert_eq!(flags_to_modifier_set(FLAG_CMD | FLAG_ALT), ModifierSet::CMD | ModifierSet::ALT);
    }

    #[test]
    fn rejects_construction_for_non_chord_combo() {
        let err = MacOsChordTap::new(|| {}, &HotkeyCombo::Fn).unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("ModifiersOnly / DoubleTap"), "got: {msg}");
    }

    #[test]
    fn rejects_construction_for_standard_combo() {
        let err = MacOsChordTap::new(
            || {},
            &HotkeyCombo::Standard {
                combo: "Cmd+Shift+Space".into(),
            },
        )
        .unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("ModifiersOnly / DoubleTap"), "got: {msg}");
    }

    #[test]
    fn modifier_only_chord_fires_once_per_press_episode() {
        let count = Arc::new(Mutex::new(0u32));
        let count_c = count.clone();
        let cb: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            *count_c.lock().unwrap() += 1;
        });
        let mode = ChordMode::ModifiersOnly { mods: ModifierSet::CMD | ModifierSet::ALT };
        let mut rt = ChordRuntime::new();

        // Press Cmd+Opt simultaneously — fires once.
        handle_flags_changed(&mut rt, mode, FLAG_CMD | FLAG_ALT, &*cb);
        assert_eq!(*count.lock().unwrap(), 1);

        // Same flags arriving again (e.g. another FlagsChanged tick
        // with the same modifiers held) must not refire.
        handle_flags_changed(&mut rt, mode, FLAG_CMD | FLAG_ALT, &*cb);
        assert_eq!(*count.lock().unwrap(), 1);

        // Release one modifier, then re-press: rearm + fire again.
        handle_flags_changed(&mut rt, mode, FLAG_CMD, &*cb);
        handle_flags_changed(&mut rt, mode, FLAG_CMD | FLAG_ALT, &*cb);
        assert_eq!(*count.lock().unwrap(), 2);
    }

    #[test]
    fn modifier_only_chord_ignores_extra_modifier() {
        let count = Arc::new(Mutex::new(0u32));
        let count_c = count.clone();
        let cb: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            *count_c.lock().unwrap() += 1;
        });
        let mode = ChordMode::ModifiersOnly { mods: ModifierSet::CMD | ModifierSet::ALT };
        let mut rt = ChordRuntime::new();

        // Cmd+Opt+Shift held — NOT an exact match, so don't fire.
        handle_flags_changed(&mut rt, mode, FLAG_CMD | FLAG_ALT | FLAG_SHIFT, &*cb);
        assert_eq!(*count.lock().unwrap(), 0);
    }

    #[test]
    fn modifier_only_chord_does_not_fire_for_subset() {
        let count = Arc::new(Mutex::new(0u32));
        let count_c = count.clone();
        let cb: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            *count_c.lock().unwrap() += 1;
        });
        let mode = ChordMode::ModifiersOnly { mods: ModifierSet::CMD | ModifierSet::ALT };
        let mut rt = ChordRuntime::new();

        handle_flags_changed(&mut rt, mode, FLAG_CMD, &*cb);
        assert_eq!(*count.lock().unwrap(), 0);
    }

    #[test]
    fn double_tap_does_not_fire_on_a_single_press_release() {
        let count = Arc::new(Mutex::new(0u32));
        let count_c = count.clone();
        let cb: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            *count_c.lock().unwrap() += 1;
        });
        let mode = ChordMode::DoubleTap { modifier: ModifierSet::CMD };
        let mut rt = ChordRuntime::new();

        // Press Cmd, release Cmd.
        handle_flags_changed(&mut rt, mode, FLAG_CMD, &*cb);
        handle_flags_changed(&mut rt, mode, 0, &*cb);
        assert_eq!(*count.lock().unwrap(), 0);
    }

    #[test]
    fn double_tap_fires_when_two_presses_arrive_in_quick_succession() {
        let count = Arc::new(Mutex::new(0u32));
        let count_c = count.clone();
        let cb: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            *count_c.lock().unwrap() += 1;
        });
        let mode = ChordMode::DoubleTap { modifier: ModifierSet::CMD };
        let mut rt = ChordRuntime::new();

        // Tap 1
        handle_flags_changed(&mut rt, mode, FLAG_CMD, &*cb);
        handle_flags_changed(&mut rt, mode, 0, &*cb);
        // Tap 2 (the test uses real time but the window is 350ms,
        // and these calls run inside microseconds of each other).
        handle_flags_changed(&mut rt, mode, FLAG_CMD, &*cb);
        assert_eq!(*count.lock().unwrap(), 1);
    }

    #[test]
    fn double_tap_poisons_when_other_modifier_is_added_between_taps() {
        let count = Arc::new(Mutex::new(0u32));
        let count_c = count.clone();
        let cb: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            *count_c.lock().unwrap() += 1;
        });
        let mode = ChordMode::DoubleTap { modifier: ModifierSet::CMD };
        let mut rt = ChordRuntime::new();

        // Tap 1: Cmd down, Cmd up
        handle_flags_changed(&mut rt, mode, FLAG_CMD, &*cb);
        handle_flags_changed(&mut rt, mode, 0, &*cb);
        // User starts a Cmd+Shift combo: Shift down (no Cmd) — this
        // shouldn't poison since Cmd isn't held; but next, Cmd added
        // — Cmd+Shift held — this is not "exactly Cmd", so poison.
        handle_flags_changed(&mut rt, mode, FLAG_SHIFT, &*cb);
        handle_flags_changed(&mut rt, mode, FLAG_CMD | FLAG_SHIFT, &*cb);
        // Now release Shift — Cmd alone. That's a "press" of Cmd but
        // it's poisoned, so no fire.
        handle_flags_changed(&mut rt, mode, FLAG_CMD, &*cb);
        assert_eq!(*count.lock().unwrap(), 0);
    }

    #[test]
    fn invalidate_blocks_in_flight_modifier_chord() {
        let count = Arc::new(Mutex::new(0u32));
        let count_c = count.clone();
        let cb: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            *count_c.lock().unwrap() += 1;
        });
        let mode = ChordMode::ModifiersOnly { mods: ModifierSet::CMD | ModifierSet::ALT };
        let mut rt = ChordRuntime::new();

        // A non-modifier KeyDown arrived (e.g. user pressed S), so
        // the in-flight chord is invalidated.
        rt.invalidate();
        // User now holds Cmd+Opt exactly — must NOT fire because the
        // chord was poisoned by the earlier non-modifier press.
        handle_flags_changed(&mut rt, mode, FLAG_CMD | FLAG_ALT, &*cb);
        assert_eq!(*count.lock().unwrap(), 0);

        // Once the user releases at least one of the required mods,
        // the chord disarms and a fresh press fires.
        handle_flags_changed(&mut rt, mode, FLAG_CMD, &*cb);
        handle_flags_changed(&mut rt, mode, FLAG_CMD | FLAG_ALT, &*cb);
        assert_eq!(*count.lock().unwrap(), 1);
    }
}
