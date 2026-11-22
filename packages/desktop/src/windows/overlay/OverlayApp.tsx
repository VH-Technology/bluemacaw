import { getOverlaySensitivity, setOverlayPlacement } from '@/lib/db';
import { vox } from '@/lib/invoke';
import {
    OVERLAY_POSITION_SETUP_OFF_EVENT,
    OVERLAY_POSITION_SETUP_ON_EVENT,
    RECORDING_STATE_EVENT,
    exitOverlayPositionSetup,
    requestRecordingCancel,
    requestRecordingToggle,
} from '@/lib/overlay-bridge';
import { coordinateSpaceFor, placementFromWindow } from '@/lib/overlay-placement';
import {
    DEFAULT_OVERLAY_SENSITIVITY,
    OVERLAY_SENSITIVITY_CHANGED_EVENT,
} from '@/lib/overlay-sensitivity';
import type { RecordingState } from '@/lib/recording-controller';
import { getPlatform } from '@/lib/use-platform';
import { listen } from '@tauri-apps/api/event';
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type OverlayState, OverlayWindow } from './OverlayWindow';

const POSITION_SAVE_DEBOUNCE_MS = 400;
const SETUP_IDLE_EXIT_MS = 3000;
// 12 Hz — smooth enough that the human eye reads it as continuous motion,
// light enough that the Tauri invoke overhead is negligible.
const LEVEL_POLL_INTERVAL_MS = 80;
// Long enough to read three short lines, short enough that the pill does
// not linger over the user's work.
const ERROR_VISIBLE_MS = 8000;

function determineOverlayState(
    rec: RecordingState,
    setupActive: boolean,
    errorDismissed: boolean,
): OverlayState {
    if (rec.kind === 'recording') return { kind: 'recording' };
    if (rec.kind === 'transcribing') return { kind: 'transcribing' };
    if (rec.kind === 'error' && !errorDismissed) return { kind: 'error', message: rec.message };
    if (setupActive) return { kind: 'positioning' };
    return { kind: 'hidden' };
}

function useOverlayRecordingState(): RecordingState {
    const [state, setState] = useState<RecordingState>({ kind: 'idle' });
    useEffect(() => {
        let cancelled = false;
        const unlisten = listen<RecordingState>(RECORDING_STATE_EVENT, (event) => {
            if (!cancelled) setState(event.payload);
        });
        return () => {
            cancelled = true;
            void unlisten.then((fn) => fn());
        };
    }, []);
    return state;
}

/**
 * How long an error stays on the pill. The error state itself lasts until
 * the next recording, but the pill only shows it for a few seconds, or
 * until the user closes it. Each error event is a new state object, so the
 * same failure happening again shows again.
 *
 * Taking the error down also hides the OS window, unless position setup is
 * keeping the pill on screen: nothing else will, because the bridge only
 * shows or hides the window on a state change.
 */
function useErrorDismissal(
    recordingState: RecordingState,
    setupActive: boolean,
): { errorDismissed: boolean; dismissError: () => void } {
    const [dismissed, setDismissed] = useState<RecordingState | null>(null);
    const setupActiveRef = useRef(setupActive);
    setupActiveRef.current = setupActive;

    const dismiss = useCallback((state: RecordingState) => {
        setDismissed(state);
        if (setupActiveRef.current) return;
        void getCurrentWindow()
            .hide()
            .catch((e) => console.warn('OverlayApp: hiding the error pill failed', e));
    }, []);

    const showing = recordingState.kind === 'error' && dismissed !== recordingState;
    useEffect(() => {
        if (!showing) return;
        const timer = setTimeout(() => dismiss(recordingState), ERROR_VISIBLE_MS);
        return () => clearTimeout(timer);
    }, [showing, recordingState, dismiss]);

    const dismissError = useCallback(() => dismiss(recordingState), [dismiss, recordingState]);
    return { errorDismissed: !showing, dismissError };
}

/** Save the window position the user dragged the chip to as a placement. */
async function saveDroppedPosition(position: { x: number; y: number }): Promise<void> {
    const [windowScaleFactor, monitors, platform] = await Promise.all([
        getCurrentWindow().scaleFactor(),
        availableMonitors(),
        getPlatform(),
    ]);
    const placement = placementFromWindow({
        position,
        windowScaleFactor,
        monitors,
        space: coordinateSpaceFor(platform.os),
    });
    if (placement) await setOverlayPlacement(placement);
}

/**
 * Remember where the user drags the chip.
 *
 * Only moves that follow a press on the drag handle are saved. The window
 * also moves without the user: the OS relocates it whenever the display
 * layout changes (a DisplayLink monitor attaching after login, waking from
 * sleep, undocking), and the bridge repositions it before each show. Saving
 * those would overwrite the user's choice with wherever the window happened
 * to land. The chip can only be dragged while it is on screen, so a drag
 * ends, at the latest, when the chip hides.
 */
function useOverlayPositionPersistence(visible: boolean): { onDragStart: () => void } {
    const draggingRef = useRef(false);

    useEffect(() => {
        if (!visible) draggingRef.current = false;
    }, [visible]);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let pending: { x: number; y: number } | null = null;

        const unlistenPromise = getCurrentWindow().onMoved(({ payload }) => {
            if (cancelled || !draggingRef.current) return;
            pending = { x: payload.x, y: payload.y };
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                if (cancelled || !pending) return;
                void saveDroppedPosition(pending).catch((e) => {
                    console.warn('OverlayApp: saving the overlay position failed', e);
                });
            }, POSITION_SAVE_DEBOUNCE_MS);
        });

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            void unlistenPromise.then((fn) => fn());
        };
    }, []);

    const onDragStart = useCallback(() => {
        draggingRef.current = true;
    }, []);
    return { onDragStart };
}

/**
 * Tracks whether the user is currently in "set position" mode (entered via
 * the Settings → Overlay toggle). When active, the overlay renders the
 * positioning pill and a 5-second idle-exit timer runs: the timer arms on
 * the first onMoved event after entering setup and resets on every
 * subsequent onMoved; once it expires, we emit the setup-off event so the
 * main window's UI reverts and the overlay hides.
 *
 * Recording wins: if a recording transition arrives while setup is active,
 * we exit setup (without hiding the window — the recording state is
 * keeping it visible).
 */
function useOverlayPositionSetup(recordingState: RecordingState): { setupActive: boolean } {
    const [setupActive, setSetupActive] = useState(false);
    const setupActiveRef = useRef(setupActive);
    setupActiveRef.current = setupActive;

    useEffect(() => {
        let cancelled = false;
        const onP = listen(OVERLAY_POSITION_SETUP_ON_EVENT, () => {
            if (!cancelled) setSetupActive(true);
        });
        const offP = listen(OVERLAY_POSITION_SETUP_OFF_EVENT, () => {
            if (!cancelled) setSetupActive(false);
        });
        return () => {
            cancelled = true;
            void onP.then((fn) => fn());
            void offP.then((fn) => fn());
        };
    }, []);

    useEffect(() => {
        if (!setupActive) return;
        if (recordingState.kind === 'recording' || recordingState.kind === 'transcribing') {
            void exitOverlayPositionSetup({ hide: false, reason: 'recording-wins' });
        }
    }, [setupActive, recordingState.kind]);

    useEffect(() => {
        if (!setupActive) return;
        let cancelled = false;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;

        const armTimer = () => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                if (cancelled) return;
                void exitOverlayPositionSetup({ hide: true, reason: 'idle' });
            }, SETUP_IDLE_EXIT_MS);
        };

        const unlistenP = getCurrentWindow().onMoved(() => {
            if (cancelled) return;
            armTimer();
        });

        return () => {
            cancelled = true;
            if (idleTimer) clearTimeout(idleTimer);
            void unlistenP.then((fn) => fn());
        };
    }, [setupActive]);

    return { setupActive };
}

/**
 * Poll the Rust side for the live microphone peak level while we're in the
 * `recording` state. Stops polling and resets to 0 on any other state so
 * the meter snaps flat the moment the user stops talking. Failures from the
 * invoke are swallowed — a missed sample is invisible, errors aren't worth
 * surfacing to the user.
 */
function useOverlayRecordingLevel(recordingState: RecordingState): number {
    const [level, setLevel] = useState(0);
    useEffect(() => {
        if (recordingState.kind !== 'recording') {
            setLevel(0);
            return;
        }
        const { sessionId } = recordingState;
        let cancelled = false;
        const tick = async () => {
            try {
                const next = await vox.getRecordingLevel(sessionId);
                if (!cancelled) setLevel(next);
            } catch {
                // Swallow — a stale session id after stop_recording is the
                // expected race when the state event arrives a frame late.
            }
        };
        // Kick off immediately so the first frame after "recording" arrives
        // already shows the live level instead of a beat of zeros.
        void tick();
        const handle = setInterval(() => void tick(), LEVEL_POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(handle);
            setLevel(0);
        };
    }, [recordingState]);
    return level;
}

function useOverlaySensitivity(recordingKind: RecordingState['kind']): number {
    const [sensitivity, setSensitivity] = useState(DEFAULT_OVERLAY_SENSITIVITY);
    // biome-ignore lint/correctness/useExhaustiveDependencies: Recording transitions intentionally reload the setting as a fallback for missed notifications.
    useEffect(() => {
        let cancelled = false;
        let revision = 0;
        const reload = async () => {
            const currentRevision = ++revision;
            try {
                const value = await getOverlaySensitivity();
                if (!cancelled && currentRevision === revision) setSensitivity(value);
            } catch (err) {
                console.warn('OverlayApp: failed to load meter sensitivity', err);
            }
        };
        const unlisten = listen(OVERLAY_SENSITIVITY_CHANGED_EVENT, () => void reload());
        // Subscribe before loading, and refresh on each recording transition
        // as a fallback for a missed cross-window notification.
        void unlisten
            .then(() => {
                if (!cancelled) void reload();
            })
            .catch((err) => {
                console.warn('OverlayApp: sensitivity listener failed', err);
                if (!cancelled) void reload();
            });
        return () => {
            cancelled = true;
            void unlisten.then((fn) => fn()).catch(() => {});
        };
    }, [recordingKind]);
    return sensitivity;
}

export function OverlayApp() {
    const recordingState = useOverlayRecordingState();
    const { setupActive } = useOverlayPositionSetup(recordingState);
    const level = useOverlayRecordingLevel(recordingState);
    const sensitivity = useOverlaySensitivity(recordingState.kind);
    const { errorDismissed, dismissError } = useErrorDismissal(recordingState, setupActive);
    const overlayState = determineOverlayState(recordingState, setupActive, errorDismissed);
    const { onDragStart } = useOverlayPositionPersistence(overlayState.kind !== 'hidden');
    return (
        <OverlayWindow
            state={overlayState}
            onStop={() => void requestRecordingToggle()}
            onCancel={() => void requestRecordingCancel()}
            level={level}
            sensitivity={sensitivity}
            onDragStart={onDragStart}
            onDismiss={dismissError}
            onOpenMain={() => {
                dismissError();
                void vox
                    .showMainWindow()
                    .catch((e) => console.warn('OverlayApp: opening the main window failed', e));
            }}
        />
    );
}
