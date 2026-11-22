use std::sync::Mutex;

use tauri::{AppHandle, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(target_os = "macos", target_os = "windows"))]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod portable;

/// What was on the clipboard before a paste borrowed it, kept so it can be
/// put back afterwards. Opaque: only the `Clipboard` that produced a snapshot
/// knows how to restore it.
pub struct ClipboardSnapshot(SnapshotKind);

enum SnapshotKind {
    /// Plain text, as held by [`InMemoryClipboard`].
    Text(String),
    #[cfg(target_os = "macos")]
    Items(macos::Items),
    #[cfg(target_os = "windows")]
    Portable(portable::Saved),
}

/// Trait abstracting clipboard read/write so callers can be tested with an
/// in-memory implementation rather than the real OS clipboard.
///
/// The three provided methods support lending the clipboard to a paste and
/// handing it back. Their defaults describe a clipboard that cannot be
/// captured: nothing is saved, the transcript is written as ordinary text,
/// and it stays there after the paste.
pub trait Clipboard: Send + Sync {
    fn write_text(&self, text: &str) -> Result<(), String>;
    fn read_text(&self) -> Result<String, String>;

    /// Capture the current contents, or `None` when they cannot be captured.
    fn snapshot(&self) -> Option<ClipboardSnapshot> {
        None
    }

    /// Write text that is only on the clipboard for the length of a paste,
    /// flagged where the OS allows so clipboard history does not record it.
    fn write_transient_text(&self, text: &str) -> Result<(), String> {
        self.write_text(text)
    }

    /// Put back contents captured by [`Clipboard::snapshot`].
    fn restore(&self, snapshot: ClipboardSnapshot) -> Result<(), String> {
        let _ = snapshot;
        Ok(())
    }
}

/// Real clipboard backed by the Tauri `tauri-plugin-clipboard-manager` plugin.
pub struct TauriClipboard<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriClipboard<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> Clipboard for TauriClipboard<R> {
    fn write_text(&self, text: &str) -> Result<(), String> {
        self.app
            .clipboard()
            .write_text(text.to_string())
            .map_err(|e| e.to_string())
    }

    fn read_text(&self) -> Result<String, String> {
        self.app.clipboard().read_text().map_err(|e| e.to_string())
    }

    #[cfg(target_os = "macos")]
    fn snapshot(&self) -> Option<ClipboardSnapshot> {
        macos::snapshot(&macos::general()).map(|items| ClipboardSnapshot(SnapshotKind::Items(items)))
    }

    #[cfg(target_os = "macos")]
    fn write_transient_text(&self, text: &str) -> Result<(), String> {
        macos::write_transient_text(&macos::general(), text)
    }

    #[cfg(target_os = "macos")]
    fn restore(&self, snapshot: ClipboardSnapshot) -> Result<(), String> {
        match snapshot.0 {
            SnapshotKind::Items(items) => macos::restore(&macos::general(), &items),
            SnapshotKind::Text(text) => self.write_text(&text),
        }
    }

    #[cfg(target_os = "windows")]
    fn snapshot(&self) -> Option<ClipboardSnapshot> {
        portable::snapshot().map(|saved| ClipboardSnapshot(SnapshotKind::Portable(saved)))
    }

    #[cfg(target_os = "windows")]
    fn write_transient_text(&self, text: &str) -> Result<(), String> {
        portable::write_transient_text(text)
    }

    #[cfg(target_os = "windows")]
    fn restore(&self, snapshot: ClipboardSnapshot) -> Result<(), String> {
        match snapshot.0 {
            SnapshotKind::Portable(saved) => portable::restore(saved),
            SnapshotKind::Text(text) => self.write_text(&text),
        }
    }
}

/// The macOS general pasteboard, without a Tauri app behind it. The native
/// probes use it to run the production paste path from a plain binary.
#[cfg(target_os = "macos")]
pub struct SystemPasteboard;

#[cfg(target_os = "macos")]
impl Clipboard for SystemPasteboard {
    fn write_text(&self, text: &str) -> Result<(), String> {
        macos::write_text(&macos::general(), text)
    }

    fn read_text(&self) -> Result<String, String> {
        macos::read_text(&macos::general())
    }

    fn snapshot(&self) -> Option<ClipboardSnapshot> {
        macos::snapshot(&macos::general()).map(|items| ClipboardSnapshot(SnapshotKind::Items(items)))
    }

    fn write_transient_text(&self, text: &str) -> Result<(), String> {
        macos::write_transient_text(&macos::general(), text)
    }

    fn restore(&self, snapshot: ClipboardSnapshot) -> Result<(), String> {
        match snapshot.0 {
            SnapshotKind::Items(items) => macos::restore(&macos::general(), &items),
            SnapshotKind::Text(text) => self.write_text(&text),
        }
    }
}

/// In-memory `Clipboard` for tests.
pub struct InMemoryClipboard {
    inner: Mutex<String>,
}

impl InMemoryClipboard {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(String::new()),
        }
    }
}

impl Default for InMemoryClipboard {
    fn default() -> Self {
        Self::new()
    }
}

impl Clipboard for InMemoryClipboard {
    fn write_text(&self, text: &str) -> Result<(), String> {
        *self.inner.lock().map_err(|e| e.to_string())? = text.to_string();
        Ok(())
    }

    fn read_text(&self) -> Result<String, String> {
        Ok(self.inner.lock().map_err(|e| e.to_string())?.clone())
    }

    fn snapshot(&self) -> Option<ClipboardSnapshot> {
        self.read_text()
            .ok()
            .map(|text| ClipboardSnapshot(SnapshotKind::Text(text)))
    }

    fn restore(&self, snapshot: ClipboardSnapshot) -> Result<(), String> {
        match snapshot.0 {
            SnapshotKind::Text(text) => self.write_text(&text),
            #[allow(unreachable_patterns)]
            _ => Err("snapshot came from a different clipboard".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_read_round_trips() {
        let c = InMemoryClipboard::new();
        c.write_text("hello").unwrap();
        assert_eq!(c.read_text().unwrap(), "hello");
    }

    #[test]
    fn defaults_to_empty_string() {
        let c = InMemoryClipboard::new();
        assert_eq!(c.read_text().unwrap(), "");
    }

    #[test]
    fn overwrites_previous_value() {
        let c = InMemoryClipboard::new();
        c.write_text("first").unwrap();
        c.write_text("second").unwrap();
        assert_eq!(c.read_text().unwrap(), "second");
    }

    #[test]
    fn snapshot_restores_what_was_there_before_a_transient_write() {
        let c = InMemoryClipboard::new();
        c.write_text("copied earlier").unwrap();

        let saved = c.snapshot().expect("in-memory clipboard is capturable");
        c.write_transient_text("dictated words").unwrap();
        assert_eq!(c.read_text().unwrap(), "dictated words");

        c.restore(saved).unwrap();
        assert_eq!(c.read_text().unwrap(), "copied earlier");
    }

    #[test]
    fn a_clipboard_without_capture_support_keeps_the_transcript() {
        struct WriteOnly(InMemoryClipboard);
        impl Clipboard for WriteOnly {
            fn write_text(&self, text: &str) -> Result<(), String> {
                self.0.write_text(text)
            }
            fn read_text(&self) -> Result<String, String> {
                self.0.read_text()
            }
        }

        let c = WriteOnly(InMemoryClipboard::new());
        assert!(c.snapshot().is_none());
        c.write_transient_text("dictated words").unwrap();
        assert_eq!(c.read_text().unwrap(), "dictated words");
    }

    #[test]
    fn clipboard_trait_is_object_safe() {
        // Verify the trait can be used as a `dyn Clipboard` trait object;
        // callers commonly pass `Arc<dyn Clipboard>` around.
        let boxed: Box<dyn Clipboard> = Box::new(InMemoryClipboard::new());
        boxed.write_text("trait obj").unwrap();
        assert_eq!(boxed.read_text().unwrap(), "trait obj");
    }
}
