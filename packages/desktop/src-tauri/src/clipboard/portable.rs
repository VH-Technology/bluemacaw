//! Clipboard save/restore through `arboard`, used on Windows. It keeps the
//! common shapes of clipboard content (files, text with its HTML form, an
//! image); anything else is reported as not capturable, and the paste then
//! leaves the transcript on the clipboard as it always has.
//!
//! Compiled on macOS as well so the shared `arboard` calls are type-checked
//! locally; macOS itself uses the lossless path in `macos.rs`.

use std::path::PathBuf;

use arboard::{Clipboard, ImageData};

pub enum Saved {
    Files(Vec<PathBuf>),
    Text { text: String, html: Option<String> },
    Image(ImageData<'static>),
}

fn open() -> Result<Clipboard, String> {
    Clipboard::new().map_err(|e| e.to_string())
}

pub fn snapshot() -> Option<Saved> {
    let mut clipboard = open().ok()?;
    if let Ok(files) = clipboard.get().file_list() {
        if !files.is_empty() {
            return Some(Saved::Files(files));
        }
    }
    if let Ok(text) = clipboard.get().text() {
        let html = clipboard.get().html().ok();
        return Some(Saved::Text { text, html });
    }
    clipboard.get().image().ok().map(Saved::Image)
}

/// Write `text` flagged to stay out of Windows clipboard history, cloud
/// clipboard sync, and third-party clipboard monitors.
pub fn write_transient_text(text: &str) -> Result<(), String> {
    let mut clipboard = open()?;
    let set = clipboard.set();
    #[cfg(target_os = "windows")]
    let set = {
        use arboard::SetExtWindows;
        set.exclude_from_monitoring()
            .exclude_from_cloud()
            .exclude_from_history()
    };
    set.text(text.to_owned()).map_err(|e| e.to_string())
}

pub fn restore(saved: Saved) -> Result<(), String> {
    let mut clipboard = open()?;
    match saved {
        Saved::Files(files) => clipboard.set().file_list(&files),
        Saved::Text {
            text,
            html: Some(html),
        } => clipboard.set().html(html, Some(text)),
        Saved::Text { text, html: None } => clipboard.set().text(text),
        Saved::Image(image) => clipboard.set().image(image),
    }
    .map_err(|e| e.to_string())
}
