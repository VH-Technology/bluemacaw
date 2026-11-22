//! Opt-in native check of clipboard-free typing. Types a known string into
//! the focused field with the production sender, so you can see whether a
//! given app accepts text delivered as Unicode key events. See
//! docs/testing.md.

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("type_probe is a macOS-only diagnostic");
    std::process::exit(1);
}

#[cfg(target_os = "macos")]
fn main() -> Result<(), String> {
    macos::run()
}

#[cfg(target_os = "macos")]
mod macos {
    use bluemacaw_lib::audio::permissions::check_accessibility_permission;
    use bluemacaw_lib::audio::PermissionState;
    use bluemacaw_lib::paste::{type_text_paced, TYPE_KEY_DELAY};
    use std::process::Command;
    use std::thread;
    use std::time::{Duration, Instant};

    const PLAIN: &str = "bluemacaw typing probe: Olá, façade, naïve — “curly quotes”, 100% done.";
    const SENTENCE: &str = "The quick brown fox jumps over the lazy dog, again and again. ";

    const USAGE: &str = "Usage: cargo run --example type_probe -- [OPTIONS] [plain|long]
  --text TEXT                  type TEXT instead of a built-in case
  --countdown SECS             seconds to focus the target field (default 5)
  --delay-ms N                 pause after each character (default: production value)
  --only-if-frontmost BUNDLE   type only if this app is frontmost when the countdown ends";

    /// Bundle id of the frontmost app, read from `lsappinfo` so the probe
    /// needs no extra permission.
    fn frontmost_bundle_id() -> Option<String> {
        let front = Command::new("/usr/bin/lsappinfo")
            .arg("front")
            .output()
            .ok()?;
        let asn = String::from_utf8(front.stdout).ok()?;
        let info = Command::new("/usr/bin/lsappinfo")
            .args(["info", "-only", "bundleid", asn.trim()])
            .output()
            .ok()?;
        // The value is the last quoted string: `bundleID="com.example.app"`.
        let line = String::from_utf8(info.stdout).ok()?;
        line.rsplit('"').nth(1).map(str::to_owned)
    }

    pub fn run() -> Result<(), String> {
        let mut text: Option<String> = None;
        let mut countdown = Duration::from_secs(5);
        let mut delay = TYPE_KEY_DELAY;
        let mut required_frontmost: Option<String> = None;
        let mut args = std::env::args().skip(1);
        while let Some(arg) = args.next() {
            let mut value = |name: &str| args.next().ok_or(format!("{name} needs a value"));
            match arg.as_str() {
                "--help" => {
                    println!("{USAGE}");
                    return Ok(());
                }
                "--text" => text = Some(value("--text")?),
                "--countdown" => {
                    let secs: f64 = value("--countdown")?
                        .parse()
                        .map_err(|_| "--countdown must be a number of seconds".to_string())?;
                    countdown = Duration::from_secs_f64(secs);
                }
                "--delay-ms" => {
                    let ms: u64 = value("--delay-ms")?
                        .parse()
                        .map_err(|_| "--delay-ms must be a whole number".to_string())?;
                    delay = Duration::from_millis(ms);
                }
                "--only-if-frontmost" => required_frontmost = Some(value("--only-if-frontmost")?),
                "plain" => text = Some(PLAIN.to_string()),
                "long" => text = Some(SENTENCE.repeat(8)),
                other => return Err(format!("Unknown argument '{other}'\n{USAGE}")),
            }
        }
        let text = text.unwrap_or_else(|| PLAIN.to_string());

        if check_accessibility_permission() != PermissionState::Granted {
            return Err(
                "Grant Accessibility to the app running this probe (your terminal), then rerun"
                    .into(),
            );
        }
        println!(
            "Typing {} characters with {delay:?} between keys. Focus a disposable text field within {countdown:?}.",
            text.chars().count()
        );
        thread::sleep(countdown);
        if let Some(required) = &required_frontmost {
            let front = frontmost_bundle_id();
            if front.as_deref() != Some(required.as_str()) {
                return Err(format!(
                    "Not typing: frontmost app is {front:?}, expected {required}"
                ));
            }
        }
        let started = Instant::now();
        type_text_paced(&text, delay)?;
        let elapsed = started.elapsed();
        // Events are delivered after this call returns; exiting now would
        // drop the tail of the text.
        thread::sleep(Duration::from_millis(500));
        println!("Posted in {elapsed:?}. The field should now hold exactly:");
        println!("{text}");
        Ok(())
    }
}
