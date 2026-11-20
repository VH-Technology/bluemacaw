import { emit } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
    LogicalPosition,
    PhysicalPosition,
    availableMonitors,
    primaryMonitor,
} from '@tauri-apps/api/window';
import {
    clearOverlayPlacement,
    getOverlayEnabled,
    getOverlayPlacement,
    getOverlayPosition,
} from './db';
import { vox } from './invoke';
import { EVT_SHORTCUT_CANCEL, EVT_SHORTCUT_TOGGLE } from './markers';
import {
    coordinateSpaceFor,
    placementFromLegacyPosition,
    resolveOverlayTarget,
} from './overlay-placement';
import type { RecordingState } from './recording-controller';
import { getPlatform } from './use-platform';

export const RECORDING_STATE_EVENT = 'bluemacaw://recording-state';
export const OVERLAY_POSITION_SETUP_ON_EVENT = 'bluemacaw://overlay-position-setup-on';
export const OVERLAY_POSITION_SETUP_OFF_EVENT = 'bluemacaw://overlay-position-setup-off';

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

type OverlayHandle = NonNullable<Awaited<ReturnType<typeof WebviewWindow.getByLabel>>>;

/**
 * Move the (hidden) chip to where it belongs for the display layout that
 * exists right now: the monitor and offset the user last dragged it to, or
 * the bottom-center of the primary monitor when nothing is saved or that
 * monitor is not connected.
 *
 * This runs before every show rather than once at startup because the
 * layout at startup is not the layout the chip will be shown on. A
 * DisplayLink monitor attaches seconds after login, in a placeholder mode
 * first, and re-attaches after every wake; a position resolved once is
 * wrong as soon as that happens. The fallback is deliberately not saved, so
 * the chip returns to the user's spot as soon as its monitor is back.
 *
 * Never throws: a chip in the wrong place beats no chip.
 */
async function placeOverlay(overlay: OverlayHandle): Promise<void> {
    try {
        const [monitors, primary, platform, placement] = await Promise.all([
            availableMonitors(),
            primaryMonitor(),
            getPlatform(),
            getOverlayPlacement(),
        ]);
        let saved = placement;
        if (!saved) {
            const legacy = await getOverlayPosition();
            saved = legacy ? placementFromLegacyPosition(legacy, monitors) : null;
        }
        const target = resolveOverlayTarget({
            saved,
            monitors,
            primary,
            space: coordinateSpaceFor(platform.os),
        });
        if (!target) return;
        await overlay.setPosition(
            target.space === 'logical'
                ? new LogicalPosition(target.x, target.y)
                : new PhysicalPosition(target.x, target.y),
        );
    } catch (e) {
        console.warn('overlay-bridge: placeOverlay failed', e);
    }
}

/**
 * Place the chip unless it is already on screen. A visible chip stays put:
 * the user may be mid-drag, or have just dropped it somewhere that has not
 * been saved yet.
 */
async function placeOverlayIfHidden(overlay: OverlayHandle): Promise<void> {
    let visible = false;
    try {
        visible = await overlay.isVisible();
    } catch (e) {
        console.warn('overlay-bridge: isVisible failed', e);
    }
    if (!visible) await placeOverlay(overlay);
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
            await placeOverlayIfHidden(overlay);
            if (isStale()) return;
            // Present via the Rust command so the pill lands on the active
            // macOS Space instead of staying pinned to its original one.
            await vox.presentOverlay();
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
        if (overlay) await placeOverlayIfHidden(overlay);
        await vox.presentOverlay();
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
 * Forget where the user put the chip, so it goes back to the bottom-center
 * of the primary monitor. A chip that is on screen right now (position
 * setup) moves immediately; a hidden one is placed on its next show.
 */
export async function resetOverlayPosition(): Promise<void> {
    try {
        await clearOverlayPlacement();
        const overlay = await WebviewWindow.getByLabel(OVERLAY_LABEL);
        if (overlay && (await overlay.isVisible())) await placeOverlay(overlay);
    } catch (e) {
        console.warn('overlay-bridge: resetOverlayPosition failed', e);
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
