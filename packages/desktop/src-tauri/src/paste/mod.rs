use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;
use std::thread::sleep;
use std::time::Duration;

#[cfg(not(target_os = "macos"))]
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::PASTE_EVENT_MARKER;

use crate::clipboard::Clipboard;

/// Inter-process settle delay between writing the clipboard and synthesising
/// the paste keystroke. macOS's `pboard` daemon — which the *receiving* app
/// queries on `Cmd+V` — may not have committed our update yet even after our
/// own process's `setString:forType:` call returns. Empirically ~50 ms is
/// enough; we use 80 ms for headroom.
const PBOARD_SETTLE_DELAY: Duration = Duration::from_millis(80);

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

/// Trait abstracting "paste text into the active application" so callers can
/// be tested without touching the real OS clipboard or synthesizing keystrokes.
///
/// The contract (per spec §6.10) is: write `text` to the clipboard, then send
/// the platform paste shortcut (Cmd+V on macOS, Ctrl+V elsewhere).
pub trait Paster: Send + Sync {
    fn paste_text(&self, text: &str) -> Result<(), String>;
}

/// Real `Paster` that combines a `Clipboard` write with an `enigo`-driven
/// synthetic paste keystroke.
pub struct EnigoPaster<C: Clipboard> {
    clipboard: Arc<C>,
}

impl<C: Clipboard> EnigoPaster<C> {
    pub fn new(clipboard: Arc<C>) -> Self {
        Self { clipboard }
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
}

impl<C: Clipboard> Paster for EnigoPaster<C> {
    fn paste_text(&self, text: &str) -> Result<(), String> {
        self.clipboard.write_text(text).map_err(|e| {
            log::error!("paste_text: clipboard write failed: {e}");
            e
        })?;
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
            return Err(wayland_fallback_error());
        }
        // Allow pboard to propagate to other processes before the keystroke.
        sleep(PBOARD_SETTLE_DELAY);
        self.send_paste_keystroke().map_err(|e| {
            log::error!("paste_text: enigo keystroke failed: {e}");
            e
        })
    }
}

/// Test mock that records every paste request instead of synthesizing
/// keystrokes. The clipboard write is still performed against the supplied
/// `Clipboard` so callers can assert clipboard state and recorded calls
/// independently.
///
/// Gated to `#[cfg(test)]` so it is excluded from the release binary.
#[cfg(test)]
pub struct RecordingPaster<C: Clipboard> {
    clipboard: Arc<C>,
    recorded: Mutex<Vec<String>>,
}

#[cfg(test)]
impl<C: Clipboard> RecordingPaster<C> {
    pub fn new(clipboard: Arc<C>) -> Self {
        Self {
            clipboard,
            recorded: Mutex::new(Vec::new()),
        }
    }

    pub fn recorded(&self) -> Vec<String> {
        self.recorded.lock().unwrap().clone()
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
