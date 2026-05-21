import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';

/**
 * Thin async wrapper around `tauri-plugin-autostart`'s frontend API.
 * Lives in its own module so test files can mock a single import path
 * instead of chasing the plugin's nested exports across every screen
 * that exposes the toggle (Settings + Onboarding).
 *
 * On macOS the plugin uses the `AppleScript` Login Item path (configured
 * in `src-tauri/src/lib.rs`); on Windows it writes to
 * `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`; on Linux it
 * drops a `.desktop` file in `~/.config/autostart`. The contract is the
 * same on all three: `enable` makes bluemacaw launch at login, `disable`
 * removes the entry, `isEnabled` reports current state.
 */
export const autostart = {
    isEnabled: () => isEnabled(),
    enable: () => enable(),
    disable: () => disable(),
    /** Convenience for components that bind a checkbox: dispatch by value. */
    set: async (value: boolean): Promise<void> => {
        if (value) {
            await enable();
        } else {
            await disable();
        }
    },
};
