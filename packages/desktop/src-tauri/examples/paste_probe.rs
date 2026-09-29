//! Opt-in native paste check. Run on the main thread so HIToolbox accepts
//! layout lookup; the event tap has its own run loop. See docs/testing.md.

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("paste_probe is a macOS-only diagnostic");
    std::process::exit(1);
}

#[cfg(target_os = "macos")]
fn main() -> Result<(), String> {
    macos::run()
}

#[cfg(target_os = "macos")]
mod macos {
    use bluemacaw_lib::audio::permissions::{
        check_accessibility_permission, check_input_monitoring_permission,
    };
    use bluemacaw_lib::audio::PermissionState;
    use bluemacaw_lib::clipboard::Clipboard;
    use bluemacaw_lib::paste::{EnigoPaster, Paster, PASTE_EVENT_MARKER};
    use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
    use core_graphics::event::{
        CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
        CGEventType, EventField, KeyCode,
    };
    use core_graphics::event_source::CGEventSourceStateID;
    use std::io::Write;
    use std::process::{Command, Stdio};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};

    struct SystemClipboard;

    impl Clipboard for SystemClipboard {
        fn write_text(&self, text: &str) -> Result<(), String> {
            let mut child = Command::new("/usr/bin/pbcopy")
                .stdin(Stdio::piped())
                .spawn()
                .map_err(|e| e.to_string())?;
            let write = child.stdin.take().unwrap().write_all(text.as_bytes());
            let status = child.wait().map_err(|e| e.to_string())?;
            write.map_err(|e| e.to_string())?;
            if !status.success() {
                return Err(format!("pbcopy failed: {status}"));
            }
            Ok(())
        }

        fn read_text(&self) -> Result<String, String> {
            let output = Command::new("/usr/bin/pbpaste")
                .output()
                .map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(format!("pbpaste failed: {}", output.status));
            }
            String::from_utf8(output.stdout).map_err(|e| e.to_string())
        }
    }

    #[derive(Clone, Debug)]
    struct ObservedEvent {
        kind: CGEventType,
        keycode: i64,
        flags: u64,
        source: i64,
        elapsed: Duration,
    }

    impl ObservedEvent {
        fn is_command_release(&self) -> bool {
            self.keycode == i64::from(KeyCode::COMMAND)
                && self.flags & CGEventFlags::CGEventFlagCommand.bits() == 0
        }
    }

    fn observe() -> Result<Arc<Mutex<Vec<ObservedEvent>>>, String> {
        let observed = Arc::new(Mutex::new(Vec::new()));
        let events = observed.clone();
        let (tx, rx) = mpsc::sync_channel(1);
        // This diagnostic process owns the tap for its lifetime. Exiting the
        // probe tears down the thread/tap, even when event validation fails.
        thread::spawn(move || {
            let started = Instant::now();
            let tap = CGEventTap::new(
                CGEventTapLocation::HID,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::ListenOnly,
                vec![
                    CGEventType::FlagsChanged,
                    CGEventType::KeyDown,
                    CGEventType::KeyUp,
                ],
                move |_, kind, event| {
                    if event.get_integer_value_field(EventField::EVENT_SOURCE_USER_DATA)
                        == PASTE_EVENT_MARKER
                        && event.get_integer_value_field(EventField::EVENT_SOURCE_UNIX_PROCESS_ID)
                            == i64::from(std::process::id())
                    {
                        events.lock().unwrap().push(ObservedEvent {
                            kind,
                            keycode: event
                                .get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE),
                            flags: event.get_flags().bits(),
                            source: event
                                .get_integer_value_field(EventField::EVENT_SOURCE_STATE_ID),
                            elapsed: started.elapsed(),
                        });
                    }
                    None
                },
            );
            let Ok(tap) = tap else {
                let _ = tx.send(Err("Could not create event tap; check Input Monitoring"));
                return;
            };
            let Ok(source) = tap.mach_port.create_runloop_source(0) else {
                let _ = tx.send(Err("Could not create event-tap run loop source"));
                return;
            };
            CFRunLoop::get_current().add_source(&source, unsafe { kCFRunLoopCommonModes });
            tap.enable();
            let _ = tx.send(Ok(()));
            CFRunLoop::run_current();
        });
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?
            .map_err(str::to_owned)?;
        Ok(observed)
    }

    fn validate(events: &[ObservedEvent]) -> Result<(), String> {
        let v_events: Vec<_> = events
            .iter()
            .filter(|event| event.keycode != i64::from(KeyCode::COMMAND))
            .collect();
        if v_events.len() != 2
            || !matches!(v_events[0].kind, CGEventType::KeyDown)
            || !matches!(v_events[1].kind, CGEventType::KeyUp)
            || v_events[0].keycode != v_events[1].keycode
        {
            return Err("Expected one matching V-down/V-up pair".into());
        }
        let command = CGEventFlags::CGEventFlagCommand;
        let shortcut_modifiers = command
            | CGEventFlags::CGEventFlagShift
            | CGEventFlags::CGEventFlagControl
            | CGEventFlags::CGEventFlagAlternate
            | CGEventFlags::CGEventFlagSecondaryFn;
        if v_events
            .iter()
            .any(|event| event.flags & shortcut_modifiers.bits() != command.bits())
        {
            return Err(
                "V event was missing Command or inherited another shortcut modifier".into(),
            );
        }
        // Private is the constructor sentinel (-1); posted private events
        // carry a runtime-assigned state-table ID, not necessarily -1.
        let source = v_events[0].source;
        if source == CGEventSourceStateID::CombinedSessionState as i64
            || source == CGEventSourceStateID::HIDSystemState as i64
            || events.iter().any(|event| event.source != source)
        {
            return Err("Paste did not use one isolated event-source state table".into());
        }
        if !events.last().is_some_and(ObservedEvent::is_command_release) {
            return Err("Missing final Command release".into());
        }
        Ok(())
    }

    pub fn run() -> Result<(), String> {
        let argument = std::env::args().nth(1);
        if argument.as_deref() == Some("--help") {
            println!("Usage: cargo run --example paste_probe -- [COUNT|--check-permissions]");
            println!(
                "Pastes numbered probe lines into the focused field after a 5-second countdown."
            );
            return Ok(());
        }
        let accessibility = check_accessibility_permission();
        let monitoring = check_input_monitoring_permission();
        println!("Accessibility: {accessibility:?}; Input Monitoring: {monitoring:?}");
        if argument.as_deref() == Some("--check-permissions") {
            return Ok(());
        }
        let count: usize = argument
            .as_deref()
            .unwrap_or("10")
            .parse()
            .map_err(|_| "COUNT must be a positive integer".to_string())?;
        if !(1..=1000).contains(&count) {
            return Err("COUNT must be between 1 and 1000".into());
        }
        if accessibility != PermissionState::Granted || monitoring != PermissionState::Granted {
            return Err(
                "Grant Accessibility and Input Monitoring to the probe's host process, then rerun"
                    .into(),
            );
        }
        let observed = observe()?;
        let paster = EnigoPaster::new(Arc::new(SystemClipboard));
        println!("Focus a disposable text field within 5 seconds. Move the physical pointer during the run.");
        thread::sleep(Duration::from_secs(5));
        for i in 1..=count {
            observed.lock().unwrap().clear();
            paster.paste_text(&format!("bluemacaw paste probe {i:03}\n"))?;
            let deadline = Instant::now() + Duration::from_secs(1);
            loop {
                if observed
                    .lock()
                    .unwrap()
                    .last()
                    .is_some_and(ObservedEvent::is_command_release)
                    || Instant::now() >= deadline
                {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
            }
            let events = observed.lock().unwrap().clone();
            for event in &events {
                println!(
                    "{i:03} {:?} key={} flags=0x{:x} source={} at={:?}",
                    event.kind, event.keycode, event.flags, event.source, event.elapsed
                );
            }
            validate(&events).map_err(|error| format!("Paste {i}: {error}"))?;
            thread::sleep(Duration::from_millis(200));
        }
        println!("Verified {count} native event sequences. Check the receiving field for exactly {count} complete numbered lines; event capture alone does not prove delivery.");
        Ok(())
    }
}
