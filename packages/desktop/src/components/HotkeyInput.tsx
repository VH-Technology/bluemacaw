import { Button } from '@/components/ui/button';
import { usePlatform } from '@/lib/use-platform';
import { useEffect, useRef, useState } from 'react';

export interface HotkeyInputProps {
    value: string;
    onChange: (combo: string) => void;
    /** Fires when the user clicks Capture; receivers can use this to
     * unregister the OS global shortcut so it doesn't intercept the
     * keydown the user is trying to capture. */
    onCaptureStart?: () => void;
    /** Fires when capture mode ends without a value (Esc / Cancel).
     * Receivers should re-register the previous shortcut. Capture-completion
     * with a new value goes through `onChange` and does NOT fire this. */
    onCaptureCancel?: () => void;
    /** Fires when the user clicks the "Use Fn" button (macOS only).
     * Receivers may need to coordinate with the OS (e.g. flip the macOS
     * "Press 🌐 key to:" setting) before calling `onChange('Fn')`. When this
     * is provided, clicking "Use Fn" only calls this; it does NOT also
     * call `onChange('Fn')` directly — the receiver decides when to commit. */
    onUseFnRequested?: () => void;
    /** Whether the macOS-only "Use Fn" button is offered. Defaults to true.
     * The cancel-recording hotkey input passes `false` because the Rust
     * cancel-hotkey command doesn't support the Fn-tap path (one tap per
     * process; collides with the toggle's Fn binding). */
    allowFn?: boolean;
    /** Whether a bare key (no modifier, e.g. Esc) is a valid capture.
     * The cancel-recording input passes `true` because its global
     * registration is scoped to the recording window. The toggle hotkey
     * leaves this at `false` so a bare-key registration can't swallow
     * other apps' key presses globally. */
    allowBareKey?: boolean;
    /** Whether modifier-only chord and double-tap captures are
     * offered. Defaults to true. The cancel-hotkey input passes `false`
     * — its backend cannot register those surfaces (one chord tap per
     * process, owned by the toggle hotkey). */
    allowChord?: boolean;
}

/** Window inside which a press-release-press sequence still counts as
 * a double-tap. Matches the Rust-side `DOUBLE_TAP_WINDOW` so capture
 * UX and runtime behavior stay aligned. */
const DOUBLE_TAP_WINDOW_MS = 350;

type ModifierName = 'Cmd' | 'Ctrl' | 'Alt' | 'Shift';

function modifierFromEvent(e: KeyboardEvent): ModifierName | null {
    if (e.key === 'Meta' || e.key === 'OS') return 'Cmd';
    if (e.key === 'Control') return 'Ctrl';
    if (e.key === 'Alt') return 'Alt';
    if (e.key === 'Shift') return 'Shift';
    return null;
}

function isModifierKey(e: KeyboardEvent): boolean {
    return modifierFromEvent(e) !== null;
}

function formatModifierOnly(mods: Set<ModifierName>): string {
    // Stable order matches the Rust formatter so the round-trip
    // through persistence is canonical.
    const order: ModifierName[] = ['Cmd', 'Ctrl', 'Alt', 'Shift'];
    return order.filter((m) => mods.has(m)).join('+');
}

function formatComboFromEvent(e: KeyboardEvent, allowBareKey: boolean): string | null {
    if (isModifierKey(e)) return null;
    // Esc cancels capture unless the caller has opted into bare keys
    // (cancel-hotkey input), in which case Esc is the canonical value.
    if (e.key === 'Escape' && !allowBareKey) return null;
    const parts: string[] = [];
    if (e.metaKey) parts.push('Cmd');
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (parts.length === 0 && !allowBareKey) return null;
    parts.push(keyLabel(e));
    return parts.join('+');
}

function keyLabel(e: KeyboardEvent): string {
    if (e.code.startsWith('Key')) return e.code.slice(3);
    if (e.code.startsWith('Digit')) return e.code.slice(5);
    if (e.code.startsWith('Arrow')) return e.code.slice(5);
    if (e.code === 'Space') return 'Space';
    if (e.code === 'Enter') return 'Enter';
    if (e.code === 'Escape') return 'Escape';
    if (e.code === 'Tab') return 'Tab';
    if (e.code === 'Backspace') return 'Backspace';
    if (e.code === 'Delete') return 'Delete';
    if (/^F\d{1,2}$/.test(e.code)) return e.code;
    return e.key.toUpperCase();
}

/** Tracker for the chord/double-tap detector. Lives across keydown +
 * keyup events while the user is composing a capture. */
interface ChordTracker {
    /** Modifiers currently physically held. */
    currentMods: Set<ModifierName>;
    /** Every modifier that's been pressed since the last "clean slate"
     * (all keys released). Used to commit Cmd+Opt-style chords on
     * keyup-of-last-modifier. */
    sequenceMods: Set<ModifierName>;
    /** True once a non-modifier key has been pressed in the current
     * sequence — that path delegates to the standard combo formatter
     * and shouldn't fall back to a chord/double-tap on keyup. */
    sawNonModifier: boolean;
    /** When the user released their only-held modifier on its own,
     * the modifier name and the release timestamp. Used to detect a
     * double-tap when the same modifier is pressed again inside
     * [`DOUBLE_TAP_WINDOW_MS`]. */
    lastSingleRelease: { mod: ModifierName; at: number } | null;
}

function freshTracker(): ChordTracker {
    return {
        currentMods: new Set(),
        sequenceMods: new Set(),
        sawNonModifier: false,
        lastSingleRelease: null,
    };
}

export function HotkeyInput({
    value,
    onChange,
    onCaptureStart,
    onCaptureCancel,
    onUseFnRequested,
    allowFn = true,
    allowBareKey = false,
    allowChord = true,
}: HotkeyInputProps) {
    const [capturing, setCapturing] = useState(false);
    const platform = usePlatform();
    // While the first fetch is in flight `platform` is null; treat that as
    // "not macOS" so the Fn-key button stays hidden until we know for sure.
    // The cache is warmed at app launch via the onboarding gate, so this
    // null window is effectively a single tick on first paint.
    const showFn = allowFn && platform?.os === 'macos';
    const showChord = allowChord && platform?.os === 'macos';
    // Tracker for the chord / double-tap detector. Held in a ref so
    // its mutations don't trigger re-renders mid-capture.
    const trackerRef = useRef<ChordTracker>(freshTracker());

    useEffect(() => {
        if (!capturing) return;
        // Reset chord state every time capture begins so an aborted
        // previous capture can't leak partial sequence into the next.
        trackerRef.current = freshTracker();

        function finish(combo: string) {
            onChange(combo);
            setCapturing(false);
        }

        function handleKeyDown(e: KeyboardEvent) {
            e.preventDefault();
            e.stopPropagation();
            // Esc handling — same as before. Cancel capture unless the
            // caller opted into bare keys (cancel-hotkey input).
            if (e.key === 'Escape' && !allowBareKey) {
                setCapturing(false);
                onCaptureCancel?.();
                return;
            }
            const tracker = trackerRef.current;
            const mod = modifierFromEvent(e);
            if (mod) {
                // Possible double-tap: same modifier was tapped alone
                // recently and is now being pressed again.
                if (
                    showChord &&
                    tracker.lastSingleRelease &&
                    tracker.lastSingleRelease.mod === mod &&
                    Date.now() - tracker.lastSingleRelease.at <= DOUBLE_TAP_WINDOW_MS &&
                    tracker.currentMods.size === 0
                ) {
                    finish(`DoubleTap+${mod}`);
                    return;
                }
                tracker.currentMods.add(mod);
                tracker.sequenceMods.add(mod);
                return;
            }
            // Non-modifier key: take the standard-combo path.
            tracker.sawNonModifier = true;
            const combo = formatComboFromEvent(e, allowBareKey);
            if (combo === null) return;
            finish(combo);
        }

        function handleKeyUp(e: KeyboardEvent) {
            const tracker = trackerRef.current;
            const mod = modifierFromEvent(e);
            if (!mod) return;
            tracker.currentMods.delete(mod);
            if (tracker.currentMods.size !== 0) return;

            // All modifiers released. Decide what (if anything) to
            // commit based on what the user pressed.
            if (tracker.sawNonModifier) {
                // Standard combo path — already committed in keydown
                // OR ignored (e.g. modifier alone followed by non-mod
                // that didn't form a valid combo). Either way, reset.
                trackerRef.current = freshTracker();
                return;
            }
            if (!showChord) {
                // Chord captures aren't available — modifier-only
                // sequences are dropped silently so the user can
                // retry with a real combo.
                trackerRef.current = freshTracker();
                return;
            }
            if (tracker.sequenceMods.size >= 2) {
                // Two or more distinct modifiers pressed without any
                // non-modifier — commit as a modifier-only chord.
                finish(formatModifierOnly(tracker.sequenceMods));
                return;
            }
            // Exactly one modifier pressed and released. Stash it as
            // a double-tap candidate; the next keydown of the same
            // modifier within the window will commit.
            tracker.lastSingleRelease = { mod, at: Date.now() };
            tracker.sequenceMods.clear();
        }

        window.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('keyup', handleKeyUp, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('keyup', handleKeyUp, true);
        };
    }, [capturing, onChange, onCaptureCancel, allowBareKey, showChord]);

    function toggle() {
        if (capturing) {
            setCapturing(false);
            onCaptureCancel?.();
        } else {
            setCapturing(true);
            onCaptureStart?.();
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <span
                    data-testid="hotkey-display"
                    className="inline-flex h-10 min-w-[12rem] items-center rounded-xl border border-border bg-muted px-3 text-sm font-semibold tracking-wider"
                >
                    {capturing ? 'Press a key combo…' : value}
                </span>
                <Button onClick={toggle}>{capturing ? 'Cancel' : 'Capture…'}</Button>
                {showFn && (
                    <Button
                        variant="outline"
                        onClick={() => {
                            if (onUseFnRequested) {
                                onUseFnRequested();
                            } else {
                                onChange('Fn');
                            }
                        }}
                        title="Use the macOS Fn key. Requires Accessibility permission."
                    >
                        Use Fn
                    </Button>
                )}
            </div>
            {capturing && showChord && (
                <p className="text-xs text-muted-foreground">
                    Press a combo with a key (e.g. Cmd+Shift+Space), or hold two modifiers together
                    (e.g. Cmd+Opt), or double-tap a single modifier.
                </p>
            )}
        </div>
    );
}
