/**
 * Realtime/streaming transcription orchestrator. Couples three pieces:
 *
 *   1. The provider's [`RealtimeModel.connect`] — opens a WebSocket and
 *      returns a [`RealtimeSession`].
 *   2. The Rust `start_recording_realtime` command — starts cpal capture
 *      AND begins emitting `EVT_AUDIO_CHUNK` events with 16 kHz mono i16
 *      PCM via the resampler.
 *   3. The TS [`listenAudioChunks`] helper — subscribes to those events,
 *      filtered by session id, and forwards each chunk to the session.
 *
 * The recording controller calls [`startRealtimeCapture`] from its
 * `startFromIdle` branch when the active model is `mode: 'realtime'`,
 * holds the returned [`RealtimeCapture`] in its recording state, and on
 * stop calls `finish()` (or `abort()` on cancel) and `unlisten()`.
 */

import type { UnlistenFn } from '@tauri-apps/api/event';
import { PROVIDERS } from '../providers';
import type { RealtimeSession } from '../providers/types';
import { bufferRealtimeSession } from './buffering-realtime-session';
import { type ModelConfigWithApiKey, getActiveModelConfigId, getModelConfigWithApiKey } from './db';
import { listenAudioChunks, vox } from './invoke';

export interface RealtimeCapture {
    /** Rust-side capture id from `start_recording_realtime`. Pass to
     *  `stopRecording` / `cancelRecording` to tear down the cpal stream. */
    rustSessionId: string;
    /** Provider session — `sendAudio` already wired to incoming chunks,
     *  `finish()` resolves with the final transcript text. */
    session: RealtimeSession;
    /** Remove the `audio-chunk` event subscription. The recording
     *  controller calls this in both stop and abort flows. */
    unlisten: UnlistenFn;
}

/**
 * Resolve the active model's transcription mode, falling back to `'batch'`
 * if anything is missing or unrecognised. Used by the recording controller
 * to decide which capture pipeline to start. Safe to call without the DB
 * being fully initialised — it swallows errors and returns `'batch'`,
 * which is the strictly safer default (no WebSocket attempts).
 */
export async function resolveActiveMode(): Promise<'batch' | 'realtime'> {
    try {
        const cfg = await resolveActiveConfig();
        if (!cfg) return 'batch';
        const provider = PROVIDERS.find((p) => p.id === cfg.providerId);
        if (!provider) return 'batch';
        const model = provider.defaultModels.find((m) => m.id === cfg.modelId);
        return model?.mode ?? 'batch';
    } catch {
        return 'batch';
    }
}

async function resolveActiveConfig(): Promise<ModelConfigWithApiKey | null> {
    const activeId = await getActiveModelConfigId();
    if (!activeId) return null;
    return getModelConfigWithApiKey(activeId);
}

/**
 * Open a realtime capture for the currently active model and start
 * recording. Order is deliberate, and optimized for "user can speak
 * immediately":
 *
 *   1. Kick off the WS handshake but DO NOT await it. Wrap the pending
 *      promise in a [`bufferRealtimeSession`] so chunks can queue while
 *      the socket comes up.
 *   2. Start the Rust capture, which gives us the session id and makes
 *      the mic live as soon as cpal opens.
 *   3. Subscribe to chunks for that session id and forward them to the
 *      buffering session. Anything captured before the WS finishes its
 *      handshake is held in memory and flushed when the inner session
 *      resolves.
 *
 * The trade-off vs. awaiting the handshake first: a connect failure now
 * surfaces lazily through `session.finish()` (or `abort()`-then-discard
 * on cancel) instead of at start time. The recording controller's
 * `stopAndTranscribe` already catches throws and renders an error state,
 * so the UX degrades to "speak, release, see error" — strictly better
 * than "stare at idle for a full RTT before you're allowed to speak".
 */
export async function startRealtimeCapture(): Promise<RealtimeCapture> {
    const cfg = await resolveActiveConfig();
    if (!cfg) {
        throw new Error('No model selected');
    }
    const provider = PROVIDERS.find((p) => p.id === cfg.providerId);
    if (!provider) {
        throw new Error(`Unknown provider: ${cfg.providerId}`);
    }
    if (!provider.makeRealtimeModel) {
        throw new Error(`${provider.name} does not support realtime transcription`);
    }
    const apiKey = await vox.getSecret(cfg.apiKeyId);
    if (!apiKey) {
        throw new Error(`No API key found in keychain for ${cfg.apiKeyNickname}`);
    }

    // 1. Kick off the WS handshake without awaiting. Attach a no-op
    //    catch so an early rejection doesn't surface as an unhandled
    //    rejection — the buffering session re-throws it via finish().
    const rtModel = provider.makeRealtimeModel(cfg.modelId, apiKey);
    const pending = rtModel.connect({ sampleRate: 16000 });
    pending.catch(() => {});
    const session = bufferRealtimeSession(pending);

    // 2. Start Rust capture. Mic is live as soon as this resolves.
    let rustSessionId: string;
    try {
        rustSessionId = await vox.startRecordingRealtime();
    } catch (e) {
        session.abort();
        throw e;
    }

    // 3. Bridge chunks → buffering session.
    let unlisten: UnlistenFn;
    try {
        unlisten = await listenAudioChunks(rustSessionId, (chunk) => {
            // `chunk.samples` is a plain number[] over IPC; wrap as
            // Int16Array so the provider adapter gets typed PCM.
            session.sendAudio(new Int16Array(chunk.samples));
        });
    } catch (e) {
        await vox.cancelRecording(rustSessionId).catch(() => {});
        session.abort();
        throw e;
    }

    return { rustSessionId, session, unlisten };
}
