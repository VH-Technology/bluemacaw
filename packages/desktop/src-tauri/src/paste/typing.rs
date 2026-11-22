//! Shared rules for clipboard-free insertion, where the transcript is sent as
//! keyboard events that carry Unicode text instead of going through a paste.
//!
//! Each event carries exactly one UTF-16 unit. A longer string per event is
//! faster and works in ordinary text fields, but Chromium treats it as input
//! method text, and xterm.js (the terminal inside VS Code, Cursor and other
//! Electron apps) then emits it several times over and out of order. One
//! unit per event arrives as an ordinary key press everywhere we tested.

/// Whether `text` has to be pasted because typing cannot deliver it as
/// written:
///
/// - a typed line break is a Return press, which sends the message in most
///   chat apps, and a typed tab moves keyboard focus in forms;
/// - a character outside the Basic Multilingual Plane (most emoji) needs two
///   UTF-16 units, and xterm.js drops such a key event.
pub fn needs_paste(text: &str) -> bool {
    text.chars()
        .any(|c| matches!(c, '\n' | '\r' | '\t') || c.len_utf16() > 1)
}

/// The UTF-16 units to type, one per key event. Only meaningful for text
/// that [`needs_paste`] accepts, where every character is a single unit.
pub fn key_units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_line_text_can_be_typed() {
        assert!(!needs_paste(
            "Olá, façade, naïve — “curly quotes”, 100% done."
        ));
    }

    #[test]
    fn line_breaks_and_tabs_need_a_paste() {
        assert!(needs_paste("first\nsecond"));
        assert!(needs_paste("first\r\nsecond"));
        assert!(needs_paste("first\rsecond"));
        assert!(needs_paste("name\tvalue"));
    }

    #[test]
    fn emoji_need_a_paste() {
        assert!(needs_paste("done 👍"));
        assert!(needs_paste("😀"));
    }

    #[test]
    fn empty_text_has_nothing_to_type() {
        assert!(!needs_paste(""));
        assert!(key_units("").is_empty());
    }

    #[test]
    fn typable_text_is_one_unit_per_character() {
        let text = "Olá — “ok”";
        let units = key_units(text);
        assert_eq!(units.len(), text.chars().count());
        assert_eq!(String::from_utf16(&units).unwrap(), text);
    }
}
