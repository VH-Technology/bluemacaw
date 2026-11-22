use std::sync::{Arc, Mutex};
use std::thread::{sleep, JoinHandle};
use std::time::Duration;

#[cfg(not(target_os = "macos"))]
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use serde::Deserialize;

#[cfg(target_os = "macos")]
mod macos;
pub mod typing;
#[cfg(target_os = "macos")]
pub use macos::{type_text_paced, PASTE_EVENT_MARKER, TYPE_KEY_DELAY};

use crate::clipboard::{Clipboard, ClipboardSnapshot};

/// Inter-process settle delay between writing the clipboard and synthesising
/// the paste keystroke. macOS's `pboard` daemon — which the *receiving* app
/// queries on `Cmd+V` — may not have committed our update yet even after our
/// own process's `setString:forType:` call returns. Empirically ~50 ms is
/// enough; we use 80 ms for headroom.
const PBOARD_SETTLE_DELAY: Duration = Duration::from_millis(80);

/// How long the transcript stays on the clipboard after the paste keystroke
/// before the previous contents come back. The receiving app reads the
/// clipboard when it gets round to handling the keystroke, not when we post
/// it, so restoring too early makes it paste the *old* contents. A second is
/// long enough for a busy Electron app and short enough that the user rarely
/// reaches for the clipboard first.
const CLIPBOARD_RESTORE_DELAY: Duration = Duration::from_millis(1000);

/// Marker prefix returned by `paste_text` on Linux Wayland sessions where
/// `enigo`'s X11/XTest backend can't synthesise keystrokes. The webview side
/// matches on this prefix (see `recording-controller.ts`) and renders a
/// dedicated "text is on your clipboard" message instead of the generic
/// paste failure. The marker prefix is centralised in
/// [`crate::markers::ERR_WAYLAND_PASTE_UNSUPPORTED`] so the JS side and the
/// Rust side cannot drift independently.
#[cfg(target_os = "linux")]
fn wayland_fallback_error() -> String {
    format!(
        "{} Wayland blocks synthetic keystrokes from third-party apps. bluemacaw copied the text to your clipboard — press Ctrl+V to paste it.",
        crate::markers::ERR_WAYLAND_PASTE_UNSUPPORTED
    )
}

// `is_wayland_session` lives in `crate::platform` so it can be shared with
// the `get_platform_info` command. The previous in-module copy was moved
// verbatim — keep both call sites in sync by importing from one source.

/// How the user wants a transcript delivered to the focused app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InsertMethod {
    /// Type the text as keyboard events. The clipboard is not touched.
    Type,
    /// Put the text on the clipboard, press the paste shortcut, then put the
    /// previous clipboard contents back.
    Paste,
}

/// Whether this platform has a clipboard-free typing path. Linux keeps the
/// paste path it has always used.
pub const fn typing_supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

/// Whether a transcript is typed rather than pasted. Typing is used only
/// when the user asked for it, the platform can do it, and the text has no
/// line break, tab or emoji (see [`typing::needs_paste`]).
fn should_type(method: InsertMethod, text: &str, typing_supported: bool) -> bool {
    method == InsertMethod::Type && typing_supported && !typing::needs_paste(text)
}

/// Deliver `text` to the focused app by the user's chosen method.
///
/// A failed typing attempt copies the text to the clipboard, so the
/// transcript is never lost and the "press paste" hint the UI shows is true.
/// A failed paste already left it there.
pub fn insert_text(paster: &dyn Paster, text: &str, method: InsertMethod) -> Result<(), String> {
    if !should_type(method, text, typing_supported()) {
        return paster.paste_text(text);
    }
    let typed = paster.type_text(text);
    if typed.is_err() {
        if let Err(e) = paster.copy_text(text) {
            log::error!("insert_text: could not copy the transcript after typing failed: {e}");
        }
    }
    typed
}

/// Trait abstracting "put text into the active application" so callers can
/// be tested without touching the real OS clipboard or synthesizing keystrokes.
pub trait Paster: Send + Sync {
    /// Write `text` to the clipboard, send the platform paste shortcut
    /// (Cmd+V on macOS, Ctrl+V elsewhere), then restore the clipboard.
    fn paste_text(&self, text: &str) -> Result<(), String>;
    /// Type `text` into the focused field without using the clipboard.
    fn type_text(&self, text: &str) -> Result<(), String>;
    /// Leave `text` on the clipboard for the user to paste by hand.
    fn copy_text(&self, text: &str) -> Result<(), String>;
}

/// The clipboard contents a paste borrowed and still owes back.
struct Loan {
    snapshot: ClipboardSnapshot,
    /// The transcript we wrote. If the clipboard no longer holds it when the
    /// restore is due, the user copied something else and we leave it alone.
    text: String,
    generation: u64,
}

#[derive(Default)]
struct LoanBook {
    generation: u64,
    pending: Option<Loan>,
}

/// Real `Paster` that combines a `Clipboard` with `enigo`-driven synthetic
/// keystrokes.
pub struct EnigoPaster<C: Clipboard + 'static> {
    clipboard: Arc<C>,
    loans: Arc<Mutex<LoanBook>>,
    settle_delay: Duration,
    restore_delay: Duration,
}

impl<C: Clipboard + 'static> EnigoPaster<C> {
    pub fn new(clipboard: Arc<C>) -> Self {
        Self {
            clipboard,
            loans: Arc::new(Mutex::new(LoanBook::default())),
            settle_delay: PBOARD_SETTLE_DELAY,
            restore_delay: CLIPBOARD_RESTORE_DELAY,
        }
    }

    /// Send the platform paste keystroke (Cmd+V on macOS, Ctrl+V elsewhere).
    /// Split out so it's swappable and so the clipboard write can be
    /// exercised independently.
    #[cfg(target_os = "macos")]
    fn send_paste_keystroke(&self) -> Result<(), String> {
        macos::send_paste_keystroke()
    }

    #[cfg(not(target_os = "macos"))]
    fn send_paste_keystroke(&self) -> Result<(), String> {
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        let modifier = if cfg!(target_os = "macos") {
            Key::Meta
        } else {
            Key::Control
        };
        enigo
            .key(modifier, Direction::Press)
            .map_err(|e| e.to_string())?;
        enigo
            .key(Key::Unicode('v'), Direction::Click)
            .map_err(|e| e.to_string())?;
        enigo
            .key(modifier, Direction::Release)
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Paste `text`, with the keystroke supplied by the caller so tests can
    /// stand in for the OS. Returns the handle of the thread that will give
    /// the clipboard back, when there is something to give back.
    fn paste_with(
        &self,
        text: &str,
        send_keystroke: impl FnOnce() -> Result<(), String>,
    ) -> Result<Option<JoinHandle<()>>, String> {
        let generation = {
            let mut loans = self.loans.lock().map_err(|e| e.to_string())?;
            // A paste that arrives before the last one was repaid must keep
            // owing the user's contents, not our own earlier transcript.
            let snapshot = match loans.pending.take() {
                Some(loan) => Some(loan.snapshot),
                None => self.clipboard.snapshot(),
            };
            self.clipboard.write_transient_text(text).map_err(|e| {
                log::error!("paste_text: clipboard write failed: {e}");
                e
            })?;
            loans.generation += 1;
            let generation = loans.generation;
            loans.pending = snapshot.map(|snapshot| Loan {
                snapshot,
                text: text.to_string(),
                generation,
            });
            generation
        };
        // On Linux Wayland, enigo's X11/XTest backend can't synthesise
        // keystrokes (the `wayland`/`libei` features are experimental and
        // not enabled in our build). Surface a structured error so the UI
        // can tell the user to press Ctrl+V manually. The clipboard write
        // above has already succeeded, so the text IS available — we just
        // can't trigger the paste keystroke for them.
        #[cfg(target_os = "linux")]
        if crate::platform::is_wayland_session() {
            log::warn!(
                "paste_text: Wayland session detected; skipping synthetic Ctrl+V (text remains on clipboard)"
            );
            self.forgive_loan(generation);
            return Err(wayland_fallback_error());
        }
        // Allow pboard to propagate to other processes before the keystroke.
        sleep(self.settle_delay);
        if let Err(e) = send_keystroke() {
            log::error!("paste_text: paste keystroke failed: {e}");
            // Keep the transcript on the clipboard so the user can paste it
            // by hand.
            self.forgive_loan(generation);
            return Err(e);
        }
        Ok(self.schedule_restore(generation))
    }

    /// Drop the loan for `generation` without restoring, leaving the
    /// transcript on the clipboard.
    fn forgive_loan(&self, generation: u64) {
        if let Ok(mut loans) = self.loans.lock() {
            if loans.pending.as_ref().is_some_and(|l| l.generation == generation) {
                loans.pending = None;
            }
        }
    }

    fn schedule_restore(&self, generation: u64) -> Option<JoinHandle<()>> {
        let owes = self
            .loans
            .lock()
            .ok()?
            .pending
            .as_ref()
            .is_some_and(|loan| loan.generation == generation);
        if !owes {
            return None;
        }
        let clipboard = self.clipboard.clone();
        let loans = self.loans.clone();
        let delay = self.restore_delay;
        Some(std::thread::spawn(move || {
            sleep(delay);
            let Ok(mut loans) = loans.lock() else { return };
            // A newer paste took over the loan; its own restore will repay it.
            if !loans.pending.as_ref().is_some_and(|l| l.generation == generation) {
                return;
            }
            let Some(loan) = loans.pending.take() else { return };
            if clipboard.read_text().ok().as_deref() != Some(loan.text.as_str()) {
                log::info!("paste_text: clipboard changed since the paste; leaving it as is");
                return;
            }
            if let Err(e) = clipboard.restore(loan.snapshot) {
                log::error!("paste_text: could not restore the clipboard: {e}");
            }
        }))
    }
}

impl<C: Clipboard + 'static> Paster for EnigoPaster<C> {
    fn paste_text(&self, text: &str) -> Result<(), String> {
        self.paste_with(text, || self.send_paste_keystroke())
            .map(|_| ())
    }

    #[cfg(target_os = "macos")]
    fn type_text(&self, text: &str) -> Result<(), String> {
        macos::type_text(text)
    }

    // Enigo sends each UTF-16 unit as a Unicode key event
    // (`KEYEVENTF_UNICODE` on Windows), independent of the keyboard layout.
    // Enigo 0.2.1 stops at the first line break or tab; `insert_text` never
    // types text that has one.
    #[cfg(not(target_os = "macos"))]
    fn type_text(&self, text: &str) -> Result<(), String> {
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo.text(text).map_err(|e| e.to_string())
    }

    fn copy_text(&self, text: &str) -> Result<(), String> {
        self.clipboard.write_text(text)
    }
}

/// Test mock that records every request instead of synthesizing keystrokes.
/// The clipboard write is still performed against the supplied `Clipboard`
/// so callers can assert clipboard state and recorded calls independently.
///
/// Gated to `#[cfg(test)]` so it is excluded from the release binary.
#[cfg(test)]
pub struct RecordingPaster<C: Clipboard> {
    clipboard: Arc<C>,
    recorded: Mutex<Vec<String>>,
    typed: Mutex<Vec<String>>,
    typing_error: Option<String>,
}

#[cfg(test)]
impl<C: Clipboard> RecordingPaster<C> {
    pub fn new(clipboard: Arc<C>) -> Self {
        Self {
            clipboard,
            recorded: Mutex::new(Vec::new()),
            typed: Mutex::new(Vec::new()),
            typing_error: None,
        }
    }

    /// A paster whose typing always fails with `error`.
    pub fn failing_to_type(clipboard: Arc<C>, error: &str) -> Self {
        Self {
            typing_error: Some(error.to_string()),
            ..Self::new(clipboard)
        }
    }

    pub fn recorded(&self) -> Vec<String> {
        self.recorded.lock().unwrap().clone()
    }

    pub fn typed(&self) -> Vec<String> {
        self.typed.lock().unwrap().clone()
    }

    pub fn call_count(&self) -> usize {
        self.recorded.lock().unwrap().len()
    }
}

#[cfg(test)]
impl<C: Clipboard> Paster for RecordingPaster<C> {
    fn paste_text(&self, text: &str) -> Result<(), String> {
        self.clipboard.write_text(text)?;
        self.recorded
            .lock()
            .map_err(|e| e.to_string())?
            .push(text.to_string());
        Ok(())
    }

    fn type_text(&self, text: &str) -> Result<(), String> {
        if let Some(error) = &self.typing_error {
            return Err(error.clone());
        }
        self.typed
            .lock()
            .map_err(|e| e.to_string())?
            .push(text.to_string());
        Ok(())
    }

    fn copy_text(&self, text: &str) -> Result<(), String> {
        self.clipboard.write_text(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clipboard::InMemoryClipboard;

    #[test]
    fn recording_paster_records_text() {
        let clip = Arc::new(InMemoryClipboard::new());
        let p = RecordingPaster::new(clip.clone());

        p.paste_text("hello world").unwrap();

        assert_eq!(p.recorded(), vec!["hello world".to_string()]);
    }

    #[test]
    fn recording_paster_writes_to_clipboard() {
        let clip = Arc::new(InMemoryClipboard::new());
        let p = RecordingPaster::new(clip.clone());

        p.paste_text("copied").unwrap();

        assert_eq!(clip.read_text().unwrap(), "copied");
    }

    #[test]
    fn recording_paster_counts_multiple_calls() {
        let clip = Arc::new(InMemoryClipboard::new());
        let p = RecordingPaster::new(clip);

        p.paste_text("first").unwrap();
        p.paste_text("second").unwrap();
        p.paste_text("third").unwrap();

        assert_eq!(p.call_count(), 3);
        assert_eq!(
            p.recorded(),
            vec![
                "first".to_string(),
                "second".to_string(),
                "third".to_string()
            ]
        );
    }

    #[test]
    fn paster_trait_is_object_safe() {
        let clip = Arc::new(InMemoryClipboard::new());
        let boxed: Box<dyn Paster> = Box::new(RecordingPaster::new(clip));
        boxed.paste_text("trait obj").unwrap();
    }

    #[test]
    fn last_call_overwrites_clipboard() {
        let clip = Arc::new(InMemoryClipboard::new());
        let p = RecordingPaster::new(clip.clone());

        p.paste_text("first").unwrap();
        p.paste_text("second").unwrap();

        assert_eq!(clip.read_text().unwrap(), "second");
    }

    mod choosing_a_method {
        use super::*;

        #[test]
        fn single_line_text_is_typed_when_typing_is_chosen() {
            assert!(should_type(InsertMethod::Type, "hello there", true));
        }

        #[test]
        fn paste_is_used_when_the_user_chose_it() {
            assert!(!should_type(InsertMethod::Paste, "hello there", true));
        }

        #[test]
        fn text_with_a_line_break_is_pasted_even_when_typing_is_chosen() {
            assert!(!should_type(InsertMethod::Type, "first\nsecond", true));
        }

        #[test]
        fn a_platform_without_typing_always_pastes() {
            assert!(!should_type(InsertMethod::Type, "hello there", false));
        }

        #[test]
        fn method_names_match_the_webview_contract() {
            let typed: InsertMethod = serde_json::from_str("\"type\"").unwrap();
            let pasted: InsertMethod = serde_json::from_str("\"paste\"").unwrap();
            assert_eq!(typed, InsertMethod::Type);
            assert_eq!(pasted, InsertMethod::Paste);
        }
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    mod inserting {
        use super::*;

        #[test]
        fn typing_leaves_the_clipboard_untouched() {
            let clip = Arc::new(InMemoryClipboard::new());
            clip.write_text("copied earlier").unwrap();
            let p = RecordingPaster::new(clip.clone());

            insert_text(&p, "dictated words", InsertMethod::Type).unwrap();

            assert_eq!(p.typed(), vec!["dictated words".to_string()]);
            assert_eq!(p.call_count(), 0);
            assert_eq!(clip.read_text().unwrap(), "copied earlier");
        }

        #[test]
        fn multi_line_text_goes_through_the_paste_path() {
            let clip = Arc::new(InMemoryClipboard::new());
            let p = RecordingPaster::new(clip);

            insert_text(&p, "first\nsecond", InsertMethod::Type).unwrap();

            assert!(p.typed().is_empty());
            assert_eq!(p.recorded(), vec!["first\nsecond".to_string()]);
        }

        #[test]
        fn a_failed_typing_attempt_copies_the_text_and_reports_the_error() {
            let clip = Arc::new(InMemoryClipboard::new());
            let p = RecordingPaster::failing_to_type(clip.clone(), "no event source");

            let result = insert_text(&p, "dictated words", InsertMethod::Type);

            assert_eq!(result, Err("no event source".to_string()));
            assert_eq!(clip.read_text().unwrap(), "dictated words");
        }
    }

    // Wayland returns before the keystroke, so these only describe the
    // platforms where a paste actually completes.
    #[cfg(not(target_os = "linux"))]
    mod lending_the_clipboard {
        use super::*;

        fn paster(clip: &Arc<InMemoryClipboard>) -> EnigoPaster<InMemoryClipboard> {
            EnigoPaster {
                settle_delay: Duration::ZERO,
                restore_delay: Duration::ZERO,
                ..EnigoPaster::new(clip.clone())
            }
        }

        fn finish(handle: Option<JoinHandle<()>>) {
            if let Some(handle) = handle {
                handle.join().unwrap();
            }
        }

        #[test]
        fn the_transcript_is_on_the_clipboard_when_the_keystroke_fires() {
            let clip = Arc::new(InMemoryClipboard::new());
            clip.write_text("copied earlier").unwrap();
            let p = paster(&clip);
            let seen = Arc::new(Mutex::new(String::new()));

            let handle = p
                .paste_with("dictated words", || {
                    *seen.lock().unwrap() = clip.read_text().unwrap();
                    Ok(())
                })
                .unwrap();
            finish(handle);

            assert_eq!(*seen.lock().unwrap(), "dictated words");
        }

        #[test]
        fn the_previous_contents_come_back_after_the_paste() {
            let clip = Arc::new(InMemoryClipboard::new());
            clip.write_text("copied earlier").unwrap();
            let p = paster(&clip);

            finish(p.paste_with("dictated words", || Ok(())).unwrap());

            assert_eq!(clip.read_text().unwrap(), "copied earlier");
        }

        #[test]
        fn a_failed_keystroke_leaves_the_transcript_for_a_manual_paste() {
            let clip = Arc::new(InMemoryClipboard::new());
            clip.write_text("copied earlier").unwrap();
            let p = paster(&clip);

            let result = p.paste_with("dictated words", || Err("no permission".to_string()));

            assert_eq!(result.err(), Some("no permission".to_string()));
            assert_eq!(clip.read_text().unwrap(), "dictated words");
            assert!(p.loans.lock().unwrap().pending.is_none());
        }

        #[test]
        fn something_the_user_copied_meanwhile_is_not_overwritten() {
            let clip = Arc::new(InMemoryClipboard::new());
            clip.write_text("copied earlier").unwrap();
            let p = EnigoPaster {
                restore_delay: Duration::from_millis(150),
                ..paster(&clip)
            };

            let handle = p.paste_with("dictated words", || Ok(())).unwrap();
            clip.write_text("copied just now").unwrap();
            finish(handle);

            assert_eq!(clip.read_text().unwrap(), "copied just now");
        }

        #[test]
        fn back_to_back_pastes_still_return_the_users_contents() {
            let clip = Arc::new(InMemoryClipboard::new());
            clip.write_text("copied earlier").unwrap();
            let p = EnigoPaster {
                restore_delay: Duration::from_millis(150),
                ..paster(&clip)
            };

            let first = p.paste_with("first transcript", || Ok(())).unwrap();
            let second = p.paste_with("second transcript", || Ok(())).unwrap();
            finish(first);
            finish(second);

            assert_eq!(clip.read_text().unwrap(), "copied earlier");
        }
    }

    #[cfg(target_os = "linux")]
    mod linux_wayland {
        use super::super::wayland_fallback_error;
        use crate::markers::ERR_WAYLAND_PASTE_UNSUPPORTED;

        #[test]
        fn wayland_fallback_error_uses_expected_prefix() {
            // The webview matches on this prefix — keep them in sync.
            assert!(wayland_fallback_error().starts_with(ERR_WAYLAND_PASTE_UNSUPPORTED));
        }
    }
}
