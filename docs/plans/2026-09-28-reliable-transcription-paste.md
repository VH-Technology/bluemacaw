# Reliable macOS transcription paste

## Scope and decision

Implement the fix only on macOS. The user tested Windows and did not observe
the failure; Linux is not a supported product platform. The earlier
cross-platform investigation does not expand this implementation's scope.

Use Enigo 0.6.1 only on macOS, explicitly enabling its isolated keyboard state.
Its backend implements `CGEventSourceStateID::Private` and explicit modifier
flags on key events. Windows retains Enigo 0.2.1 and its current input path.

This uses the maintained CoreGraphics fix without introducing our own
keyboard-layout resolver or event-source lifetime management. A global Enigo
upgrade would affect other platforms as well, so dependencies are target-gated.

## Evidence

- The previous macOS sender used Enigo 0.2.1's `CombinedSessionState`, with
  20 ms inter-event sleeps but no explicit Command flags on V.
- Physical input could interfere with the modifier state, resulting in a
  plain V. [Enigo #201](https://github.com/enigo-rs/enigo/issues/201) reproduces
  the same mechanism with Cmd+A becoming a plain `a` during mouse movement.
- [Enigo #329](https://github.com/enigo-rs/enigo/pull/329) introduced explicit
  modifier flags. The inspected 0.6.1 source sets flags on both down/up events
  and selects a private source when `independent_of_keyboard_state` is true.
- The application's 80 ms clipboard-settle delay precedes the shortcut and
  does not solve modifier-state interference.

## Implementation

1. **Target-specific dependencies:** use the alias `enigo_macos` for 0.6.1,
   with default features disabled. Retain 0.2.1 on non-macOS targets. Regenerate
   the lockfile with Cargo and verify the dependency trees for macOS/Windows.
2. **macOS sender:** route `EnigoPaster` through `paste/macos.rs`. Explicitly
   configure private keyboard state, disable Enigo's own permission prompts,
   keep drop-based key release, and tag events with `PASTE_EVENT_MARKER`.
3. **Sequencing:** preserve layout-aware `Key::Unicode('v')`. Attempt Command
   release even if V fails; preserve the original error if cleanup also fails.
   Do not retry a potentially completed paste. Retain the sync Tauri command
   for HIToolbox and Enigo's pending-event lifetime handling.
4. **Permissions:** map Enigo's permission-denied result to the existing
   Accessibility-required marker if permission changes after preflight.
5. **Shortcut isolation:** ignore tagged events before the Fn/chord/double-tap
   handlers modify state, including ignoring synthetic V for gesture
   invalidation purposes.
6. **Tests:** add regression tests at the production key-emission and shortcut
   state-machine boundaries. Confirm cleanup and shortcut-feedback tests fail
   against the old behavior before implementing the fix.
7. **Native diagnostic:** provide an opt-in `paste_probe` example using the
   production sender and a listen-only event tap. Check actual event flags,
   private source, and final release; separately verify receiver text.
8. **Documentation:** describe the macOS sender, probe, and toolchain requirement
   in the architecture, testing, troubleshooting, and desktop docs.
9. **Delivery:** bump the patch version to 1.1.2 with `bun run version:bump 1.1.2`,
   verify all five version sources, and open a draft PR.

## Validation

Automated checks:

```sh
# packages/desktop/src-tauri
cargo test --lib
cargo check --example paste_probe --locked
cargo check --release --locked
cargo tree --locked --target aarch64-apple-darwin -i enigo@0.6.1
cargo tree --locked --target x86_64-pc-windows-msvc -i enigo@0.2.1
```

Also run the desktop Vitest suite, root lint/typecheck, and the version check.
Existing CI provides the native Windows build/test check; inspecting its
dependency graph locally does not substitute for compiling on Windows.

Native macOS acceptance, using both the probe and actual application:

- Repeated pastes with a stationary pointer and continuous physical movement.
- Physical recording-hotkey releases near paste completion and held modifiers.
- Default hotkey, Fn, modifier-only chords, and double-tap Command; no extra
  recording toggles or stuck modifier state.
- Selection replacement/caret insertion in TextEdit, a browser field, and an
  Electron editor, including non-US and Dvorak layouts.
- Exactly one complete insertion per request. Event capture alone does not
  prove the receiving app accepted the paste.

The native probe requires Accessibility and Input Monitoring for its host
process. Report missing permissions or unperformed manual checks explicitly;
unit-test success is not a local reproduction of the intermittent OS failure.
