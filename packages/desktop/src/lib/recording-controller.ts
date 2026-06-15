import {
    getActiveModelConfigId,
    getModelConfigWithApiKey,
    getSelectedMicDeviceId,
    saveTranscription,
} from './db';
import type { vox as voxApi } from './invoke';
import {
    ERR_ACCESSIBILITY_REQUIRED,
    ERR_MIC_DENIED,
    ERR_WAYLAND_PASTE_UNSUPPORTED,
} from './markers';
import type { transcribe as transcribeFn } from './transcribe';
import {
    type RealtimeCapture,
    resolveActiveMode as defaultResolveActiveMode,
    startRealtimeCapture as defaultStartRealtimeCapture,
} from './transcribe-realtime';

export type RecordingState =
    | { kind: 'idle' }
    | {
          kind: 'recording';
          sessionId: string;
          startedAt: number;
          /** Present when the active model is realtime — carries the WS
           *  session + chunk-listener cleanup. Absent for batch sessions. */
          realtime?: RealtimeCapture;
      }
    | { kind: 'transcribing' }
    | { kind: 'error'; message: string };

export interface RecordingDeps {
    vox: Pick<
        typeof voxApi,
        | 'startRecording'
        | 'stopRecording'
        | 'cancelRecording'
        | 'pasteText'
        | 'checkMicrophonePermission'
        | 'requestMicrophonePermission'
        | 'duckSystemVolume'
        | 'restoreSystemVolume'
    >;
    transcribe: typeof transcribeFn;
    /** Persist a finished transcription. Defaults to db.saveTranscription. */
    saveTranscription?: typeof saveTranscription;
    /** Resolve the active model config for the history record. Defaults to db lookup. */
    resolveActiveConfig?: () => Promise<{ providerId: string; modelId: string } | null>;
    /**
     * Decide whether this recording should run batch or realtime. Defaults
     * to the live DB-driven resolver; tests can pin the mode without
     * mocking the DB. Falls back to `'batch'` on any error so a missing
     * config never silently engages the realtime pipeline.
     */
    resolveActiveMode?: () => Promise<'batch' | 'realtime'>;
    /** Read the mic the user selected in Settings. Defaults to DB lookup. */
    getSelectedMicDeviceId?: () => Promise<string | null>;
    /** Inject for tests — defaults to the production realtime orchestrator. */
    startRealtimeCapture?: (deviceId?: string) => Promise<RealtimeCapture>;
}

export type SetState = (next: RecordingState) => void;

function errMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// Fire-and-forget volume ducking. Never awaited — a slow/failed OS volume
// call must not delay capture start/stop or surface as a recording error.
function duckVolume(deps: RecordingDeps): void {
    void deps.vox.duckSystemVolume().catch(() => {});
}
function restoreVolume(deps: RecordingDeps): void {
    void deps.vox.restoreSystemVolume().catch(() => {});
}

/**
 * Explicitly gate on mic permission BEFORE calling `start_recording`.
 *
 * cpal's implicit permission prompt (which fires the first time `build_input_stream`
 * touches an AVAudioEngine input on macOS) does not reliably trigger the system
 * dialog on production-signed builds — see tauri-apps/tauri#9928. We sidestep
 * that path entirely by calling `AVCaptureDevice.requestAccess` ourselves via
 * the `request_microphone_permission` command before the cpal code runs.
 *
 * The returned `mic-denied:` prefix mirrors the `accessibility-required:` marker
 * used elsewhere so the UI layer can recognise structured permission errors.
 */
async function ensureMicPermission(
    deps: RecordingDeps,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    const state = await deps.vox.checkMicrophonePermission();
    if (state === 'Granted') return { ok: true };
    if (state === 'Denied') {
        return {
            ok: false,
            reason: `${ERR_MIC_DENIED} Microphone access is blocked. Open System Settings → Privacy & Security → Microphone and enable bluemacaw.`,
        };
    }
    // NotDetermined — trigger the OS prompt now (via AVCaptureDevice.requestAccess
    // in the Rust side), not later when cpal opens the input stream.
    const after = await deps.vox.requestMicrophonePermission();
    if (after === 'Granted') return { ok: true };
    return {
        ok: false,
        reason: `${ERR_MIC_DENIED} Microphone permission was not granted.`,
    };
}

async function startFromIdle(deps: RecordingDeps, setState: SetState): Promise<void> {
    try {
        const gate = await ensureMicPermission(deps);
        if (!gate.ok) {
            setState({ kind: 'error', message: gate.reason });
            return;
        }
        const getDeviceId = deps.getSelectedMicDeviceId ?? getSelectedMicDeviceId;
        const selectedDeviceId = await getDeviceId();
        const deviceId = selectedDeviceId ?? undefined;

        const resolveMode = deps.resolveActiveMode ?? defaultResolveActiveMode;
        const mode = await resolveMode();
        if (mode === 'realtime') {
            const startRt = deps.startRealtimeCapture ?? defaultStartRealtimeCapture;
            const realtime = await startRt(deviceId);
            setState({
                kind: 'recording',
                sessionId: realtime.rustSessionId,
                startedAt: Date.now(),
                realtime,
            });
            duckVolume(deps);
            return;
        }
        const sessionId = await deps.vox.startRecording(deviceId);
        setState({ kind: 'recording', sessionId, startedAt: Date.now() });
        duckVolume(deps);
    } catch (e) {
        setState({ kind: 'error', message: errMessage(e) });
    }
}

async function defaultResolveActiveConfig(): Promise<{
    providerId: string;
    modelId: string;
} | null> {
    const activeId = await getActiveModelConfigId();
    if (!activeId) return null;
    const cfg = await getModelConfigWithApiKey(activeId);
    if (!cfg) return null;
    return { providerId: cfg.providerId, modelId: cfg.modelId };
}

async function stopAndTranscribe(
    state: Extract<RecordingState, { kind: 'recording' }>,
    deps: RecordingDeps,
    setState: SetState,
): Promise<void> {
    // Restore the volume the moment the user finishes — transcription/paste
    // can run at normal volume.
    restoreVolume(deps);
    try {
        const durationMs = Math.max(0, Date.now() - state.startedAt);
        let text: string;
        if (state.realtime) {
            // Realtime path: tell Rust to stop cpal (discard the buffered
            // WAV — the WS session already received the streamed audio),
            // unsubscribe from chunk events, and await the provider's
            // final transcript.
            await deps.vox.stopRecording(state.sessionId).catch((err) => {
                // The cpal stream shutting down ahead of finish() shouldn't
                // strand the WS session. Log and continue to finish().
                console.warn('stopRecording (realtime) failed; finishing WS anyway', err);
            });
            state.realtime.unlisten();
            setState({ kind: 'transcribing' });
            text = await state.realtime.session.finish();
        } else {
            const bytes = await deps.vox.stopRecording(state.sessionId);
            setState({ kind: 'transcribing' });
            const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });
            text = await deps.transcribe(blob);
        }

        let pasteFailed: string | null = null;
        try {
            await deps.vox.pasteText(text);
        } catch (pasteErr) {
            // Don't lose the transcription — the text is on the clipboard
            // either way. We just couldn't synthesise Cmd+V. Surface the
            // error to the UI but still save to history.
            pasteFailed = errMessage(pasteErr);
            console.error('pasteText failed', pasteErr);
        }

        // Persist after paste attempt (success or failure — the transcription
        // still happened and the user paid for it). A history-write failure
        // must not un-paste the text, so swallow + log instead of bubbling up.
        const save = deps.saveTranscription ?? saveTranscription;
        const resolveConfig = deps.resolveActiveConfig ?? defaultResolveActiveConfig;
        try {
            const cfg = await resolveConfig();
            if (cfg) {
                await save({
                    text,
                    durationMs,
                    providerId: cfg.providerId,
                    modelId: cfg.modelId,
                });
            }
        } catch (saveErr) {
            console.error('saveTranscription failed', saveErr);
        }

        if (pasteFailed) {
            // Translate well-known error markers into helpful UI messages.
            // Marker prefixes are defined in `@/lib/markers` (mirrored from
            // `src-tauri/src/markers.rs`) so a Rust rename can't silently
            // degrade UX — the contract test enforces agreement.
            let friendly: string;
            if (pasteFailed.includes(ERR_ACCESSIBILITY_REQUIRED)) {
                friendly =
                    "Couldn't paste — bluemacaw needs Accessibility permission. Text is on your clipboard; press Cmd+V to paste manually. Grant bluemacaw in System Settings → Privacy & Security → Accessibility, then try again.";
            } else if (pasteFailed.includes(ERR_WAYLAND_PASTE_UNSUPPORTED)) {
                friendly =
                    "Couldn't paste — Wayland blocks synthetic keystrokes. Text is on your clipboard; press Ctrl+V to paste it.";
            } else {
                friendly = `Couldn't paste: ${pasteFailed}. The text is on your clipboard; press Cmd+V to paste it.`;
            }
            setState({ kind: 'error', message: friendly });
            return;
        }

        setState({ kind: 'idle' });
    } catch (e) {
        setState({ kind: 'error', message: errMessage(e) });
    }
}

export async function toggle(
    state: RecordingState,
    deps: RecordingDeps,
    setState: SetState,
): Promise<void> {
    switch (state.kind) {
        case 'idle':
            await startFromIdle(deps, setState);
            return;
        case 'recording':
            await stopAndTranscribe(state, deps, setState);
            return;
        case 'transcribing':
            // Ignore — already in flight.
            return;
        case 'error':
            await startFromIdle(deps, setState);
            return;
    }
}

/**
 * Abort an in-progress recording. Tells the Rust side to drop the buffered
 * audio (no STT request is made, no paste happens) and transitions straight
 * back to `idle`. No-op in any state other than `recording` — once the audio
 * has been handed off to the transcribe path we're committed.
 */
export async function cancel(
    state: RecordingState,
    deps: RecordingDeps,
    setState: SetState,
): Promise<void> {
    if (state.kind !== 'recording') return;
    // Cancelling ends the recording too — put the volume back.
    restoreVolume(deps);
    if (state.realtime) {
        // Realtime: drop the WS session and unsubscribe BEFORE we ask Rust
        // to stop, so the few chunks still in flight don't trigger a
        // post-abort send that would race with the close.
        try {
            state.realtime.unlisten();
        } catch (e) {
            console.warn('audio-chunk unlisten failed on cancel', e);
        }
        try {
            state.realtime.session.abort();
        } catch (e) {
            console.warn('realtime session abort failed', e);
        }
    }
    try {
        await deps.vox.cancelRecording(state.sessionId);
    } catch (e) {
        // Cancellation is the user telling us they don't want this. Swallow
        // backend errors so a quirky cancel can never strand the UI in a
        // half-recording state — log and return to idle either way.
        console.warn('cancelRecording failed; returning to idle anyway', e);
    }
    setState({ kind: 'idle' });
}
