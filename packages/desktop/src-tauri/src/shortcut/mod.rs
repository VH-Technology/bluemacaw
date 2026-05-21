use serde::{Deserialize, Serialize};

pub mod parse;

#[cfg(target_os = "macos")]
pub mod macos_chord;
#[cfg(target_os = "macos")]
pub mod macos_fn;

/// Hotkey combination supported by the [`ShortcutManager`] surface.
///
/// Variants beyond `Standard` are routed to a `CGEventTap`-based
/// backend because `tauri-plugin-global-shortcut` cannot observe
/// either the secondary-fn modifier or pure modifier transitions —
/// the plugin's `RegisterHotKey`/`global-hotkey` foundation requires
/// a non-modifier key on every binding. The chord/double-tap paths
/// are macOS-only in v1; non-macOS platforms surface a clear error.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum HotkeyCombo {
    Fn,
    /// Modifier-only chord such as Cmd+Opt — fires when the exact
    /// modifier set becomes held and nothing else has been pressed.
    /// The `mods` u8 follows the bit layout in
    /// [`parse::ModifierSet`].
    ModifiersOnly { mods: u8 },
    /// Double-tap of a single modifier within a short window
    /// (~350ms). Same bit layout as `mods` above, but exactly one
    /// bit set.
    DoubleTap { modifier: u8 },
    Standard { combo: String },
}

#[derive(Debug, thiserror::Error)]
pub enum ShortcutError {
    /// Accessibility (TCC `kTCCServiceAccessibility`) is required to *post*
    /// synthetic key events (paste via `CGEventPost`). Kept distinct from
    /// [`Self::InputMonitoringRequired`] which gates *listening* via
    /// `CGEventTap`.
    #[error("accessibility permission required for synthetic keystroke")]
    AccessibilityRequired,
    /// Input Monitoring (TCC `kTCCServiceListenEvent`) is required to install
    /// the `CGEventTap` that observes the Fn modifier. This is the
    /// permission the Fn-key shortcut needs — Accessibility alone is not
    /// enough.
    #[error("input monitoring permission required for Fn-key shortcut")]
    InputMonitoringRequired,
    #[error("shortcut backend error: {0}")]
    Backend(String),
}

/// Cross-platform contract for hotkey backends.
///
/// Production wires standard hotkey registration inline in
/// [`crate::commands::register_hotkey`] via `app.global_shortcut().on_shortcut(...)`
/// for [`HotkeyCombo::Standard`], and (on macOS) [`macos_fn::MacOsFnTap`]
/// for [`HotkeyCombo::Fn`].
pub trait ShortcutManager: Send + Sync {
    fn register(&self, combo: HotkeyCombo) -> Result<(), ShortcutError>;
    fn unregister(&self) -> Result<(), ShortcutError>;
}
