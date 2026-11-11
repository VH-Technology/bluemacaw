//! macOS uses Enigo's private event source and explicit modifier flags so
//! physical mouse/key events cannot turn the synthetic Cmd+V into a bare V.
use enigo_macos::{Direction, Enigo, Key, Keyboard, NewConError, Settings};

use crate::markers::ERR_ACCESSIBILITY_REQUIRED;

/// Identifies our synthetic paste events to shortcut listeners and diagnostics.
pub const PASTE_EVENT_MARKER: i64 = 0x424c_5545_5041_5354; // "BLUEPAST"

pub(super) fn send_paste_keystroke() -> Result<(), String> {
    let settings = Settings {
        independent_of_keyboard_state: true,
        open_prompt_to_get_permissions: false,
        release_keys_when_dropped: true,
        event_source_user_data: Some(PASTE_EVENT_MARKER),
        ..Settings::default()
    };
    // Keep this on the sync command's thread: Unicode key lookup uses HIToolbox.
    // Enigo also waits for pending events on drop; retain that lifetime handling.
    let mut enigo = Enigo::new(&settings).map_err(connection_error)?;
    send_cmd_v(|key, direction| enigo.key(key, direction).map_err(|e| e.to_string()))
}

fn connection_error(error: NewConError) -> String {
    match error {
        // Permission can be revoked between the command's preflight and here.
        NewConError::NoPermission => format!(
            "{ERR_ACCESSIBILITY_REQUIRED} synthetic paste needs Accessibility. Grant bluemacaw in System Settings → Privacy & Security → Accessibility, then try again."
        ),
        other => other.to_string(),
    }
}

fn send_cmd_v(mut send: impl FnMut(Key, Direction) -> Result<(), String>) -> Result<(), String> {
    send(Key::Meta, Direction::Press)?;
    let paste = send(Key::Unicode('v'), Direction::Click);
    // Always attempt release after pressing Command, including on a V failure.
    // Drop-based release remains a fallback. Never retry the paste itself.
    let release = send(Key::Meta, Direction::Release);
    if let Err(ref error) = release {
        log::error!("paste_text: Command release failed: {error}");
    }
    paste.and(release)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn simulate(fail_at: &[usize]) -> (Result<(), String>, Vec<(Key, Direction)>) {
        let mut events = Vec::new();
        let result = send_cmd_v(|key, direction| {
            events.push((key, direction));
            let index = events.len() - 1;
            if fail_at.contains(&index) {
                Err(format!("event {index} failed"))
            } else {
                Ok(())
            }
        });
        (result, events)
    }

    #[test]
    fn successful_paste_releases_command_once() {
        let (result, events) = simulate(&[]);
        assert_eq!(result, Ok(()));
        assert_eq!(
            events,
            vec![
                (Key::Meta, Direction::Press),
                (Key::Unicode('v'), Direction::Click),
                (Key::Meta, Direction::Release),
            ]
        );
    }

    #[test]
    fn failed_command_press_does_not_send_v() {
        let (result, events) = simulate(&[0]);
        assert_eq!(result, Err("event 0 failed".into()));
        assert_eq!(events, vec![(Key::Meta, Direction::Press)]);
    }

    #[test]
    fn failed_v_still_releases_command() {
        let (result, events) = simulate(&[1]);
        assert_eq!(result, Err("event 1 failed".into()));
        assert_eq!(events.last(), Some(&(Key::Meta, Direction::Release)));
    }

    #[test]
    fn release_failure_is_reported_without_retrying_paste() {
        let (result, events) = simulate(&[2]);
        assert_eq!(result, Err("event 2 failed".into()));
        assert_eq!(events.len(), 3);
    }

    #[test]
    fn cleanup_failure_preserves_original_error() {
        let (result, events) = simulate(&[1, 2]);
        assert_eq!(result, Err("event 1 failed".into()));
        assert_eq!(events.len(), 3);
    }

    #[test]
    fn permission_loss_preserves_the_frontend_error_marker() {
        assert!(connection_error(NewConError::NoPermission).starts_with(ERR_ACCESSIBILITY_REQUIRED));
    }
}
