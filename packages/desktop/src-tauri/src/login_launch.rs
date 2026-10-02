//! Detects whether this process was started by the OS at login rather than
//! by the user opening the app. `lib.rs` uses it to keep the main window
//! hidden on a login launch, so bluemacaw comes up in the tray only.
//!
//! Two signals, either one is enough:
//!
//! - [`AUTOSTART_FLAG`] on the command line. Windows and Linux forward the
//!   autostart entry's arguments to the process.
//! - The launch falls within [`LOGIN_LAUNCH_WINDOW_SECS`] of the console
//!   login. macOS needs this because a Login Item cannot carry arguments
//!   (`auto-launch` only honours `--hidden`, which macOS ignores), and a
//!   restart can also relaunch the app through "reopen windows when logging
//!   back in", which bypasses the Login Item entirely.

use std::time::{SystemTime, UNIX_EPOCH};

/// CLI flag the autostart entry passes on platforms that forward arguments
/// (Windows registry `Run` value, Linux `.desktop` `Exec`).
pub const AUTOSTART_FLAG: &str = "--autostart";

/// How long after the console login a launch still counts as a login launch.
/// Login items start within seconds of login; two minutes leaves room for a
/// slow boot. The cost of the heuristic: opening the app by hand inside this
/// window (when it is not already running) needs one extra Dock/tray click.
const LOGIN_LAUNCH_WINDOW_SECS: i64 = 120;

/// One `USER_PROCESS` record from the system login database (what `who`
/// prints): who logged in, on which line, and when (Unix seconds).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoginRecord {
    pub user: String,
    pub line: String,
    pub login_secs: i64,
}

/// Pure decision behind [`launched_at_login`]: `args` is the process command
/// line, `now_secs` the current Unix time, `console_login_secs` when the
/// user's console session began (if known).
pub fn is_login_launch<I, S>(args: I, now_secs: i64, console_login_secs: Option<i64>) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    if args.into_iter().any(|arg| arg.as_ref() == AUTOSTART_FLAG) {
        return true;
    }
    console_login_secs
        .map(|login| (0..=LOGIN_LAUNCH_WINDOW_SECS).contains(&(now_secs - login)))
        .unwrap_or(false)
}

/// The most recent console (GUI) login among `records`, restricted to `user`
/// when the current user is known. Terminal sessions (`ttys*`) are ignored.
pub fn latest_console_login(records: &[LoginRecord], user: Option<&str>) -> Option<i64> {
    records
        .iter()
        .filter(|record| record.line == "console")
        .filter(|record| user.map_or(true, |user| record.user == user))
        .map(|record| record.login_secs)
        .max()
}

/// Whether the OS started this process at login. Call once, at startup.
pub fn launched_at_login() -> bool {
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    is_login_launch(std::env::args(), now_secs, console_login_secs())
}

/// When the current user's console session began, from the utmpx login
/// database (the same records `who` prints).
#[cfg(target_os = "macos")]
fn console_login_secs() -> Option<i64> {
    fn field_to_string(field: &[libc::c_char]) -> String {
        let bytes: Vec<u8> = field
            .iter()
            .take_while(|&&c| c != 0)
            .map(|&c| c as u8)
            .collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    let mut records = Vec::new();
    // SAFETY: the utmpx iteration API keeps process-global state and is not
    // thread-safe. This runs once from Tauri's `setup` hook on the main
    // thread, and each entry is copied out before the next `getutxent` call
    // invalidates it.
    unsafe {
        libc::setutxent();
        loop {
            let entry = libc::getutxent();
            if entry.is_null() {
                break;
            }
            let entry = &*entry;
            if entry.ut_type != libc::USER_PROCESS {
                continue;
            }
            records.push(LoginRecord {
                user: field_to_string(&entry.ut_user),
                line: field_to_string(&entry.ut_line),
                login_secs: entry.ut_tv.tv_sec as i64,
            });
        }
        libc::endutxent();
    }
    latest_console_login(&records, std::env::var("USER").ok().as_deref())
}

/// Windows and Linux rely on [`AUTOSTART_FLAG`] alone.
#[cfg(not(target_os = "macos"))]
fn console_login_secs() -> Option<i64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 10_000;

    fn record(user: &str, line: &str, login_secs: i64) -> LoginRecord {
        LoginRecord {
            user: user.to_string(),
            line: line.to_string(),
            login_secs,
        }
    }

    #[test]
    fn autostart_flag_marks_a_login_launch_without_any_login_record() {
        assert!(is_login_launch(["bluemacaw", "--autostart"], NOW, None));
    }

    #[test]
    fn launch_shortly_after_console_login_is_a_login_launch() {
        assert!(is_login_launch(["bluemacaw"], NOW, Some(9_970)));
    }

    #[test]
    fn launch_two_minutes_after_console_login_still_counts() {
        assert!(is_login_launch(["bluemacaw"], NOW, Some(9_880)));
    }

    #[test]
    fn launch_later_than_two_minutes_after_login_is_a_manual_launch() {
        assert!(!is_login_launch(["bluemacaw"], NOW, Some(9_879)));
    }

    #[test]
    fn launch_days_into_a_session_is_a_manual_launch() {
        assert!(!is_login_launch(["bluemacaw"], 1_000_000, Some(400_000)));
    }

    #[test]
    fn launch_without_flag_or_login_record_is_a_manual_launch() {
        assert!(!is_login_launch(["bluemacaw"], NOW, None));
    }

    #[test]
    fn login_record_in_the_future_is_not_a_login_launch() {
        // A clock adjustment can leave the recorded login ahead of "now".
        assert!(!is_login_launch(["bluemacaw"], NOW, Some(10_050)));
    }

    #[test]
    fn console_login_ignores_terminal_sessions() {
        let records = [
            record("gui", "console", 1_000),
            record("gui", "ttys003", 5_000),
        ];
        assert_eq!(latest_console_login(&records, Some("gui")), Some(1_000));
    }

    #[test]
    fn console_login_ignores_other_users() {
        let records = [
            record("other", "console", 9_000),
            record("gui", "console", 1_000),
        ];
        assert_eq!(latest_console_login(&records, Some("gui")), Some(1_000));
    }

    #[test]
    fn console_login_takes_the_most_recent_record() {
        let records = [
            record("gui", "console", 1_000),
            record("gui", "console", 4_000),
            record("gui", "console", 2_000),
        ];
        assert_eq!(latest_console_login(&records, Some("gui")), Some(4_000));
    }

    #[test]
    fn console_login_accepts_any_user_when_the_current_user_is_unknown() {
        let records = [record("gui", "console", 1_000)];
        assert_eq!(latest_console_login(&records, None), Some(1_000));
    }

    #[test]
    fn console_login_is_none_without_a_console_record() {
        let records = [record("gui", "ttys003", 5_000)];
        assert_eq!(latest_console_login(&records, Some("gui")), None);
    }
}
