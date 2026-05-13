import { emit } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { currentMonitor } from '@tauri-apps/api/window';
import { getOverlayEnabled, setOverlayPosition } from './db';
import { EVT_SHORTCUT_CANCEL, EVT_SHORTCUT_TOGGLE } from './markers';
import type { RecordingState } from './recording-controller';

export const RECORDING_STATE_EVENT = 'bluemacaw://recording-state';
export const OVERLAY_POSITION_SETUP_ON_EVENT = 'bluemacaw://overlay-position-setup-on';
export const OVERLAY_POSITION_SETUP_OFF_EVENT = 'bluemacaw://overlay-position-setup-off';
export const OVERLAY_RESET_POSITION_EVENT = 'bluemacaw://overlay-reset-position';

const OVERLAY_LABEL = 'overlay';

async function shouldShowOverlay(state: RecordingState): Promise<boolean> {
    if (state.kind !== 'recording' && state.kind !== 'transcribing') return false;
    try {
        return await getOverlayEnabled();
    } catch (e) {
        // If the setting can't be read, fall back to showing — don't silently
        // strand the user without feedback.
        console.warn('overlay-bridge: getOverlayEnabled failed, defaulting to true', e);
        return true;
    }
}

/**
 * Monotonic sequence id incremented on every `publishRecordingState` call.
 * Each call captures the id at entry and re-checks after every await: if a
 * later call has started, the in-flight call drops its OS-level show/hide
 * because a more recent state transition is now authoritative.
 *
 * Without this, a fast transcription that goes `recording → transcribing
 * → idle` in short succession can ship the publish calls concurrently.
 * The `idle` publish reaches `overlay.hide()` first (it skips the slower
 * `getOverlayEnabled` SQL read because `shouldShowOverlay` returns false
 * synchronously for non-recording/transcribing states). The `transcribing`
 * publish then completes `getOverlayEnabled` and calls `overlay.show()`
 * — re-showing the pill *after* the state machine has already moved on.
 * Net symptom: "Transcribing…" pill stays forever in the overlay even
 * though the transcription saved successfully and the dashboard updated.
 */
let publishSeq = 0;

/**
 * Broadcast a recording state transition to the overlay window: emits a
 * Tauri event the overlay listens for, then shows or hides the overlay's
 * OS window based on the state kind and the user's `overlay_enabled`
 * setting. Side-effect-only and never throws — an overlay quirk must not
 * break the recording flow.
 *
 * If a newer `publishRecordingState` call has started while this one was
 * awaiting an async step, this call drops its remaining OS-level work
 * (show/hide) so the latest call wins. The event emit itself still goes
 * through so the overlay's in-window React listener observes every
 * transition in order.
 */
export async function publishRecordingState(state: RecordingState): Promise<void> {
    const mySeq = ++publishSeq;
    const isStale = () => mySeq !== publishSeq;

    try {
        await emit(RECORDING_STATE_EVENT, state);
    } catch (e) {
        console.warn('overlay-bridge: emit failed', e);
    }
    if (isStale()) return;

    let overlay: Awaited<ReturnType<typeof WebviewWindow.getByLabel>> | null = null;
    try {
        overlay = await WebviewWindow.getByLabel(OVERLAY_LABEL);
    } catch (e) {
        console.warn('overlay-bridge: getByLabel failed', e);
        return;
    }
    if (!overlay) return;
    if (isStale()) return;

    let show: boolean;
    try {
        show = await shouldShowOverlay(state);
    } catch (e) {
        console.warn('overlay-bridge: shouldShowOverlay failed', e);
        return;
    }
    if (isStale()) return;

    try {
        if (show) {
            await overlay.show();
        } else {
            await overlay.hide();
        }
    } catch (e) {
        console.warn('overlay-bridge: show/hide failed', e);
    }
}

/**
 * Test-only helper: reset the publish-sequence counter between tests so
 * each test starts from the same baseline. Production code never imports
 * this.
 */
export function __resetPublishSeqForTests(): void {
    publishSeq = 0;
}

/**
 * Hide the overlay window unconditionally. Used by the settings toggle so
 * that disabling the overlay mid-session takes effect immediately instead
 * of waiting for the next state transition.
 */
export async function hideOverlayWindow(): Promise<void> {
    try {
        const overlay = await WebviewWindow.getByLabel(OVERLAY_LABEL);
        await overlay?.hide();
    } catch (e) {
        console.warn('overlay-bridge: hideOverlayWindow failed', e);
    }
}

/**
 * Start "set position" mode: tell the overlay to render its positioning
 * pill and show the OS window so the user can drag it.
 */
export async function enterOverlayPositionSetup(): Promise<void> {
    try {
        await emit(OVERLAY_POSITION_SETUP_ON_EVENT, null);
    } catch (e) {
        console.warn('overlay-bridge: enterOverlayPositionSetup emit failed', e);
    }
    try {
        const overlay = await WebviewWindow.getByLabel(OVERLAY_LABEL);
        await overlay?.show();
    } catch (e) {
        console.warn('overlay-bridge: enterOverlayPositionSetup show failed', e);
    }
}

/** Why setup mode is exiting — drives whether to surface a confirmation toast. */
export type SetupExitReason = 'manual' | 'idle' | 'recording-wins';

export interface SetupExitPayload {
    reason: SetupExitReason;
}

/**
 * End "set position" mode. Always emits the off event so listeners on both
 * sides can sync their state. If `hide` is true, also hides the OS window;
 * pass `false` when something else (a recording transition) is keeping the
 * window visible.
 */
export async function exitOverlayPositionSetup(
    options: { hide: boolean; reason?: SetupExitReason } = { hide: true },
): Promise<void> {
    const reason: SetupExitReason = options.reason ?? 'manual';
    try {
        const payload: SetupExitPayload = { reason };
        await emit(OVERLAY_POSITION_SETUP_OFF_EVENT, payload);
    } catch (e) {
        console.warn('overlay-bridge: exitOverlayPositionSetup emit failed', e);
    }
    if (!options.hide) return;
    try {
        const overlay = await WebviewWindow.getByLabel(OVERLAY_LABEL);
        await overlay?.hide();
    } catch (e) {
        console.warn('overlay-bridge: exitOverlayPositionSetup hide failed', e);
    }
}

/**
 * Trigger the overlay to recompute its default bottom-center position. The
 * overlay listens for this event and calls `setPosition`; its existing
 * onMoved-debounce save will then write the default coords to db.
 */
const OVERLAY_WIDTH_PX = 280;
const OVERLAY_HEIGHT_PX = 64;
const OVERLAY_BOTTOM_MARGIN_PX = 80;

export async function resetOverlayPosition(): Promise<void> {
    // Compute a sane default in physical pixels for the current monitor and
    // write it to the DB ourselves before emitting. Previously we only
    // emitted the reset event and relied on the overlay's onMoved-debounce
    // to persist — if a corrupted DB value parked the window off-screen,
    // setPosition wouldn't necessarily trigger an onMoved, so the bad value
    // survived the reset.
    try {
        const monitor = await currentMonitor();
        if (monitor) {
            const target = {
                x: Math.round((monitor.size.width - OVERLAY_WIDTH_PX) / 2),
                y: monitor.size.height - OVERLAY_HEIGHT_PX - OVERLAY_BOTTOM_MARGIN_PX,
            };
            await setOverlayPosition(target);
        }
    } catch (e) {
        console.warn('overlay-bridge: resetOverlayPosition DB rewrite failed', e);
    }

    try {
        await emit(OVERLAY_RESET_POSITION_EVENT, null);
    } catch (e) {
        console.warn('overlay-bridge: resetOverlayPosition emit failed', e);
    }
}

/**
 * Request that the recording state machine toggle (idle→recording or
 * recording→transcribing→idle). Used by the overlay's Stop button so the
 * user can stop with the mouse instead of the hotkey.
 *
 * Re-uses the same event the OS-level global shortcut handler fires
 * (`EVT_SHORTCUT_TOGGLE`) so a click in the overlay drives the existing
 * `useHotkeyRecording` state machine in the main window without a new
 * listener — keep the constant centralised in `@/lib/markers` to avoid drift.
 */
export async function requestRecordingToggle(): Promise<void> {
    try {
        await emit(EVT_SHORTCUT_TOGGLE, null);
    } catch (e) {
        console.warn('overlay-bridge: requestRecordingToggle failed', e);
    }
}

/**
 * Cancel an in-progress recording. Emits the same event the cancel-hotkey
 * fires (`EVT_SHORTCUT_CANCEL`) so a click on the overlay's X button takes
 * the exact same code path as the global shortcut.
 */
export async function requestRecordingCancel(): Promise<void> {
    try {
        await emit(EVT_SHORTCUT_CANCEL, null);
    } catch (e) {
        console.warn('overlay-bridge: requestRecordingCancel failed', e);
    }
}
