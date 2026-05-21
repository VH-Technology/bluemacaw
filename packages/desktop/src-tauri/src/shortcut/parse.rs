use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ParseError {
    #[error("combo is empty")]
    Empty,
    #[error("combo has no modifier (need at least one of Cmd, Ctrl, Alt, Shift)")]
    NoModifier,
    #[error("combo has no key (need a non-modifier key like Space or A)")]
    NoKey,
    #[error("unknown key: {0}")]
    UnknownKey(String),
    #[error("double-tap combo needs exactly one modifier (got: {0})")]
    DoubleTapNeedsOneModifier(String),
}

/// Modifier bitset shared by the modifier-only and double-tap combo
/// variants. The flags mirror `tauri_plugin_global_shortcut::Modifiers`
/// for the standard combo path but live in a plain `u8` so the variant
/// can be `Copy` and serialize cleanly across the IPC boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ModifierSet(pub u8);

impl ModifierSet {
    pub const CMD: u8 = 1 << 0;
    pub const CTRL: u8 = 1 << 1;
    pub const ALT: u8 = 1 << 2;
    pub const SHIFT: u8 = 1 << 3;

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }
    pub fn contains(self, flag: u8) -> bool {
        (self.0 & flag) != 0
    }
    pub fn count(self) -> u32 {
        self.0.count_ones()
    }
}

/// Try to parse a modifier-only combo string (e.g. `"Cmd+Opt"`).
/// Returns `Ok(Some(...))` on success, `Ok(None)` when the input has a
/// non-modifier component (i.e. it's a normal combo and should go
/// through `parse_combo`), and `Err` when the parts that ARE present
/// are individually unrecognisable.
pub fn parse_modifiers_only(input: &str) -> Result<Option<ModifierSet>, ParseError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ParseError::Empty);
    }
    let mut mods = ModifierSet::default();
    for raw in trimmed.split('+') {
        let part = raw.trim();
        if part.is_empty() {
            continue;
        }
        match part.to_ascii_lowercase().as_str() {
            "cmd" | "command" | "meta" | "super" | "win" | "windows" => mods.0 |= ModifierSet::CMD,
            "ctrl" | "control" => mods.0 |= ModifierSet::CTRL,
            "alt" | "option" | "opt" => mods.0 |= ModifierSet::ALT,
            "shift" => mods.0 |= ModifierSet::SHIFT,
            // A non-modifier component means this isn't a modifier-only
            // combo — bail with Ok(None) so the caller falls through to
            // the standard-combo path.
            _ => return Ok(None),
        }
    }
    if mods.count() < 2 {
        // A "modifier-only chord" with only one modifier would collide
        // with regular usage of that key (e.g. Cmd held while typing
        // text), so we require at least two distinct modifiers. The
        // single-modifier shortcut surface is double-tap, not chord.
        return Ok(None);
    }
    Ok(Some(mods))
}

/// Try to parse a double-tap combo string (e.g. `"DoubleTap+Cmd"`).
/// Returns `Ok(Some(modifier))` on success, `Ok(None)` if the input
/// doesn't start with the `DoubleTap` marker, and `Err` if it does but
/// the trailing modifier is missing or invalid.
pub fn parse_double_tap(input: &str) -> Result<Option<u8>, ParseError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ParseError::Empty);
    }
    let mut parts = trimmed.split('+').map(|p| p.trim()).filter(|p| !p.is_empty());
    let Some(first) = parts.next() else {
        return Err(ParseError::Empty);
    };
    if !first.eq_ignore_ascii_case("doubletap") && !first.eq_ignore_ascii_case("double-tap") {
        return Ok(None);
    }
    let rest: Vec<&str> = parts.collect();
    if rest.len() != 1 {
        return Err(ParseError::DoubleTapNeedsOneModifier(trimmed.to_string()));
    }
    let mod_flag = match rest[0].to_ascii_lowercase().as_str() {
        "cmd" | "command" | "meta" | "super" | "win" | "windows" => ModifierSet::CMD,
        "ctrl" | "control" => ModifierSet::CTRL,
        "alt" | "option" | "opt" => ModifierSet::ALT,
        "shift" => ModifierSet::SHIFT,
        _ => return Err(ParseError::DoubleTapNeedsOneModifier(trimmed.to_string())),
    };
    Ok(Some(mod_flag))
}

pub fn parse_combo(input: &str) -> Result<Shortcut, ParseError> {
    parse_combo_inner(input, /* require_modifier */ true)
}

/// Variant of [`parse_combo`] that accepts bare keys (e.g. `"Esc"`).
/// Used for the cancel-recording hotkey, which is only ever registered
/// while a recording is in flight — so consuming a bare key globally is
/// scoped to that short window and won't block other apps' Esc presses
/// during normal use.
pub fn parse_combo_permissive(input: &str) -> Result<Shortcut, ParseError> {
    parse_combo_inner(input, /* require_modifier */ false)
}

fn parse_combo_inner(input: &str, require_modifier: bool) -> Result<Shortcut, ParseError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ParseError::Empty);
    }
    let mut mods = Modifiers::empty();
    let mut key: Option<Code> = None;
    for raw in trimmed.split('+') {
        let part = raw.trim();
        if part.is_empty() {
            continue;
        }
        match part.to_ascii_lowercase().as_str() {
            "cmd" | "command" | "meta" | "super" | "win" | "windows" => {
                mods |= Modifiers::SUPER;
            }
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "alt" | "option" | "opt" => mods |= Modifiers::ALT,
            "shift" => mods |= Modifiers::SHIFT,
            other => {
                if key.is_some() {
                    return Err(ParseError::UnknownKey(other.to_string()));
                }
                key = Some(parse_key(other).ok_or_else(|| {
                    ParseError::UnknownKey(other.to_string())
                })?);
            }
        }
    }
    let Some(k) = key else {
        if mods.is_empty() {
            return Err(ParseError::NoModifier);
        }
        return Err(ParseError::NoKey);
    };
    if require_modifier && mods.is_empty() {
        return Err(ParseError::NoModifier);
    }
    let mods_opt = if mods.is_empty() { None } else { Some(mods) };
    Ok(Shortcut::new(mods_opt, k))
}

pub fn format_combo(shortcut: &Shortcut) -> String {
    let mut parts: Vec<&str> = Vec::with_capacity(5);
    if shortcut.mods.contains(Modifiers::SUPER) {
        parts.push("Cmd");
    }
    if shortcut.mods.contains(Modifiers::CONTROL) {
        parts.push("Ctrl");
    }
    if shortcut.mods.contains(Modifiers::ALT) {
        parts.push("Alt");
    }
    if shortcut.mods.contains(Modifiers::SHIFT) {
        parts.push("Shift");
    }
    let mut out = parts.join("+");
    if !out.is_empty() {
        out.push('+');
    }
    out.push_str(&format_key(shortcut.key));
    out
}

fn parse_key(s: &str) -> Option<Code> {
    let upper = s.to_ascii_uppercase();
    if upper.len() == 1 {
        let c = upper.chars().next()?;
        if c.is_ascii_alphabetic() {
            return Some(letter_code(c));
        }
        if c.is_ascii_digit() {
            return Some(digit_code(c));
        }
    }
    match upper.as_str() {
        "SPACE" => Some(Code::Space),
        "ENTER" | "RETURN" => Some(Code::Enter),
        "ESC" | "ESCAPE" => Some(Code::Escape),
        "TAB" => Some(Code::Tab),
        "BACKSPACE" => Some(Code::Backspace),
        "DELETE" | "DEL" => Some(Code::Delete),
        "UP" | "ARROWUP" => Some(Code::ArrowUp),
        "DOWN" | "ARROWDOWN" => Some(Code::ArrowDown),
        "LEFT" | "ARROWLEFT" => Some(Code::ArrowLeft),
        "RIGHT" | "ARROWRIGHT" => Some(Code::ArrowRight),
        "F1" => Some(Code::F1),
        "F2" => Some(Code::F2),
        "F3" => Some(Code::F3),
        "F4" => Some(Code::F4),
        "F5" => Some(Code::F5),
        "F6" => Some(Code::F6),
        "F7" => Some(Code::F7),
        "F8" => Some(Code::F8),
        "F9" => Some(Code::F9),
        "F10" => Some(Code::F10),
        "F11" => Some(Code::F11),
        "F12" => Some(Code::F12),
        _ => None,
    }
}

fn letter_code(c: char) -> Code {
    match c {
        'A' => Code::KeyA, 'B' => Code::KeyB, 'C' => Code::KeyC, 'D' => Code::KeyD,
        'E' => Code::KeyE, 'F' => Code::KeyF, 'G' => Code::KeyG, 'H' => Code::KeyH,
        'I' => Code::KeyI, 'J' => Code::KeyJ, 'K' => Code::KeyK, 'L' => Code::KeyL,
        'M' => Code::KeyM, 'N' => Code::KeyN, 'O' => Code::KeyO, 'P' => Code::KeyP,
        'Q' => Code::KeyQ, 'R' => Code::KeyR, 'S' => Code::KeyS, 'T' => Code::KeyT,
        'U' => Code::KeyU, 'V' => Code::KeyV, 'W' => Code::KeyW, 'X' => Code::KeyX,
        'Y' => Code::KeyY, 'Z' => Code::KeyZ,
        _ => unreachable!("letter_code called with non-letter {c}"),
    }
}

fn digit_code(c: char) -> Code {
    match c {
        '0' => Code::Digit0, '1' => Code::Digit1, '2' => Code::Digit2, '3' => Code::Digit3,
        '4' => Code::Digit4, '5' => Code::Digit5, '6' => Code::Digit6, '7' => Code::Digit7,
        '8' => Code::Digit8, '9' => Code::Digit9,
        _ => unreachable!("digit_code called with non-digit {c}"),
    }
}

fn format_key(code: Code) -> String {
    use Code::*;
    let s = match code {
        KeyA => "A", KeyB => "B", KeyC => "C", KeyD => "D", KeyE => "E",
        KeyF => "F", KeyG => "G", KeyH => "H", KeyI => "I", KeyJ => "J",
        KeyK => "K", KeyL => "L", KeyM => "M", KeyN => "N", KeyO => "O",
        KeyP => "P", KeyQ => "Q", KeyR => "R", KeyS => "S", KeyT => "T",
        KeyU => "U", KeyV => "V", KeyW => "W", KeyX => "X", KeyY => "Y", KeyZ => "Z",
        Digit0 => "0", Digit1 => "1", Digit2 => "2", Digit3 => "3", Digit4 => "4",
        Digit5 => "5", Digit6 => "6", Digit7 => "7", Digit8 => "8", Digit9 => "9",
        Space => "Space", Enter => "Enter", Escape => "Escape", Tab => "Tab",
        Backspace => "Backspace", Delete => "Delete",
        ArrowUp => "Up", ArrowDown => "Down", ArrowLeft => "Left", ArrowRight => "Right",
        F1 => "F1", F2 => "F2", F3 => "F3", F4 => "F4", F5 => "F5", F6 => "F6",
        F7 => "F7", F8 => "F8", F9 => "F9", F10 => "F10", F11 => "F11", F12 => "F12",
        other => return format!("{other:?}"),
    };
    s.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rejects_empty() {
        assert_eq!(parse_combo(""), Err(ParseError::Empty));
        assert_eq!(parse_combo("   "), Err(ParseError::Empty));
    }

    #[test]
    fn parse_rejects_modifier_only() {
        assert_eq!(parse_combo("Cmd"), Err(ParseError::NoKey));
        assert_eq!(parse_combo("Cmd+Shift"), Err(ParseError::NoKey));
    }

    #[test]
    fn parse_rejects_key_only() {
        assert_eq!(parse_combo("Space"), Err(ParseError::NoModifier));
        assert_eq!(parse_combo("A"), Err(ParseError::NoModifier));
    }

    #[test]
    fn parse_permissive_accepts_bare_key() {
        // The cancel-recording hotkey runs through the permissive parser
        // because we only register it while a recording is in flight, so
        // a bare Esc binding is safe — other apps still see Esc when no
        // recording is active.
        let s = parse_combo_permissive("Esc").unwrap();
        assert!(s.mods.is_empty());
        assert_eq!(s.key, Code::Escape);
    }

    #[test]
    fn parse_permissive_still_rejects_empty_input() {
        assert_eq!(parse_combo_permissive(""), Err(ParseError::Empty));
    }

    #[test]
    fn parse_permissive_still_requires_a_key() {
        // Modifier-only combos go through a different code path entirely
        // (see HotkeyCombo::ModifiersOnly) so the permissive parser still
        // demands at least one non-modifier key.
        assert_eq!(parse_combo_permissive("Cmd"), Err(ParseError::NoKey));
    }

    #[test]
    fn parse_permissive_accepts_combo_with_modifier() {
        let s = parse_combo_permissive("Cmd+Esc").unwrap();
        assert_eq!(s.mods, Modifiers::SUPER);
        assert_eq!(s.key, Code::Escape);
    }

    #[test]
    fn parse_rejects_unknown_key() {
        assert!(matches!(
            parse_combo("Cmd+Foobar"),
            Err(ParseError::UnknownKey(_))
        ));
    }

    #[test]
    fn parse_accepts_cmd_shift_space() {
        let s = parse_combo("Cmd+Shift+Space").unwrap();
        assert_eq!(s.mods, Modifiers::SUPER | Modifiers::SHIFT);
        assert_eq!(s.key, Code::Space);
    }

    #[test]
    fn parse_accepts_ctrl_shift_space() {
        let s = parse_combo("Ctrl+Shift+Space").unwrap();
        assert_eq!(s.mods, Modifiers::CONTROL | Modifiers::SHIFT);
        assert_eq!(s.key, Code::Space);
    }

    #[test]
    fn parse_is_case_insensitive_for_modifiers() {
        let a = parse_combo("cmd+shift+space").unwrap();
        let b = parse_combo("CMD+SHIFT+SPACE").unwrap();
        assert_eq!(a.mods, b.mods);
        assert_eq!(a.key, b.key);
    }

    #[test]
    fn parse_alt_option_alias() {
        let a = parse_combo("Alt+A").unwrap();
        let b = parse_combo("Option+A").unwrap();
        assert_eq!(a.mods, b.mods);
        assert_eq!(a.mods, Modifiers::ALT);
    }

    #[test]
    fn parse_function_keys() {
        assert_eq!(parse_combo("Cmd+F1").unwrap().key, Code::F1);
        assert_eq!(parse_combo("Cmd+F12").unwrap().key, Code::F12);
    }

    #[test]
    fn parse_arrows() {
        assert_eq!(parse_combo("Cmd+Up").unwrap().key, Code::ArrowUp);
        assert_eq!(parse_combo("Cmd+Down").unwrap().key, Code::ArrowDown);
        assert_eq!(parse_combo("Cmd+Left").unwrap().key, Code::ArrowLeft);
        assert_eq!(parse_combo("Cmd+Right").unwrap().key, Code::ArrowRight);
    }

    #[test]
    fn format_roundtrip() {
        for input in ["Cmd+Shift+Space", "Ctrl+Alt+A", "Cmd+F5", "Shift+Tab"] {
            let parsed = parse_combo(input).unwrap();
            let formatted = format_combo(&parsed);
            let reparsed = parse_combo(&formatted).unwrap();
            assert_eq!(
                parsed.mods, reparsed.mods,
                "mods drift on input {input}: got {formatted}"
            );
            assert_eq!(
                parsed.key, reparsed.key,
                "key drift on input {input}: got {formatted}"
            );
        }
    }

    #[test]
    fn format_uses_stable_modifier_order() {
        let s = parse_combo("Shift+Cmd+Alt+Ctrl+A").unwrap();
        let formatted = format_combo(&s);
        assert_eq!(formatted, "Cmd+Ctrl+Alt+Shift+A");
    }

    // ---- Modifier-only chord parser ----------------------------------

    #[test]
    fn modifiers_only_accepts_two_modifiers() {
        let mods = parse_modifiers_only("Cmd+Opt").unwrap().unwrap();
        assert!(mods.contains(ModifierSet::CMD));
        assert!(mods.contains(ModifierSet::ALT));
        assert!(!mods.contains(ModifierSet::CTRL));
        assert!(!mods.contains(ModifierSet::SHIFT));
    }

    #[test]
    fn modifiers_only_is_case_insensitive() {
        let a = parse_modifiers_only("cmd+option").unwrap().unwrap();
        let b = parse_modifiers_only("CMD+OPT").unwrap().unwrap();
        let c = parse_modifiers_only("Command+Alt").unwrap().unwrap();
        assert_eq!(a.0, b.0);
        assert_eq!(a.0, c.0);
    }

    #[test]
    fn modifiers_only_rejects_single_modifier() {
        // A bare `Cmd` would collide with normal usage of Cmd; the
        // single-modifier surface is double-tap, not a chord. The
        // parser returns Ok(None) so the caller falls through.
        assert_eq!(parse_modifiers_only("Cmd").unwrap(), None);
    }

    #[test]
    fn modifiers_only_returns_none_for_normal_combo() {
        // Standard combos contain a non-modifier component, so the
        // modifier-only parser punts back to the caller.
        assert_eq!(parse_modifiers_only("Cmd+Shift+Space").unwrap(), None);
    }

    #[test]
    fn modifiers_only_rejects_empty_input() {
        assert_eq!(parse_modifiers_only("").unwrap_err(), ParseError::Empty);
    }

    #[test]
    fn modifiers_only_accepts_three_modifiers() {
        let mods = parse_modifiers_only("Cmd+Ctrl+Opt").unwrap().unwrap();
        assert_eq!(mods.count(), 3);
        assert!(mods.contains(ModifierSet::CMD));
        assert!(mods.contains(ModifierSet::CTRL));
        assert!(mods.contains(ModifierSet::ALT));
    }

    // ---- Double-tap parser -------------------------------------------

    #[test]
    fn double_tap_accepts_each_modifier() {
        assert_eq!(parse_double_tap("DoubleTap+Cmd").unwrap(), Some(ModifierSet::CMD));
        assert_eq!(parse_double_tap("DoubleTap+Ctrl").unwrap(), Some(ModifierSet::CTRL));
        assert_eq!(parse_double_tap("DoubleTap+Opt").unwrap(), Some(ModifierSet::ALT));
        assert_eq!(parse_double_tap("DoubleTap+Shift").unwrap(), Some(ModifierSet::SHIFT));
    }

    #[test]
    fn double_tap_is_case_insensitive() {
        assert_eq!(parse_double_tap("doubletap+cmd").unwrap(), Some(ModifierSet::CMD));
        assert_eq!(parse_double_tap("double-tap+CMD").unwrap(), Some(ModifierSet::CMD));
    }

    #[test]
    fn double_tap_returns_none_for_non_double_tap_input() {
        assert_eq!(parse_double_tap("Cmd+Space").unwrap(), None);
        assert_eq!(parse_double_tap("Fn").unwrap(), None);
    }

    #[test]
    fn double_tap_rejects_multi_modifier() {
        // Double-tap is by definition a single modifier pressed twice;
        // a two-modifier value is a user input error.
        assert!(matches!(
            parse_double_tap("DoubleTap+Cmd+Opt").unwrap_err(),
            ParseError::DoubleTapNeedsOneModifier(_),
        ));
    }

    #[test]
    fn double_tap_rejects_missing_modifier() {
        assert!(matches!(
            parse_double_tap("DoubleTap").unwrap_err(),
            ParseError::DoubleTapNeedsOneModifier(_),
        ));
    }
}
