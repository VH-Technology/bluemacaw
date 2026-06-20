/**
 * WebSocket client for ElevenLabs Scribe v2 Realtime
 * (https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime).
 *
 * Wire protocol summary:
 * - Browser-side WebSocket can't set the `xi-api-key` header, so we follow
 *   ElevenLabs' documented client-side auth flow: HTTP POST to the
 *   single-use token endpoint with our API key as a header, then connect
 *   the WebSocket with that token in `?token=...`. Single-use tokens
 *   expire after 15 minutes, which is plenty for one recording session.
 * - URL: `wss://api.elevenlabs.io/v1/speech-to-text/realtime` with query
 *   params `model_id`, `audio_format=pcm_16000`, and `token=<single_use>`.
 * - On connect, the server pushes a `session_started` message; we wait for
 *   that before declaring the session ready.
 * - Audio is sent as JSON `input_audio_chunk` messages with base64-encoded
 *   16 kHz mono i16 PCM. `commit: true` on the final chunk forces
 *   finalization; the server then replies with `committed_transcript`
 *   (or `committed_transcript_with_timestamps` if enabled).
 * - Multiple `committed_transcript`s can arrive over a session (one per
 *   speech segment when VAD-commit is on); we concatenate them for the
 *   final return.
 *
 * Tested via a hand-rolled mock WebSocket — MSW v2 has WS interception,
 * but a small custom mock keeps the test focused on protocol shape rather
 * than network machinery.
 */

import { type WebSocketFactory, defaultWebSocketFactory } from './realtime-ws';
import type { RealtimeModel, RealtimeSession } from './types';

// Re-exported so existing importers (and tests) keep a single entry point.
export type { WebSocketFactory, WebSocketLike } from './realtime-ws';

const BASE_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe';

export interface ConnectScribeRealtimeOpts {
    modelId: string;
    apiKey: string;
    sampleRate: number;
    /**
     * Injection seam for tests. Defaults to a thin wrapper over
     * `globalThis.WebSocket`. Tests pass an in-memory mock.
     */
    webSocketFactory?: WebSocketFactory;
    /**
     * Injection seam for tests. Defaults to `globalThis.fetch`. Used to
     * exchange the user's API key for a single-use token before opening
     * the WebSocket.
     */
    fetchFn?: typeof fetch;
}

/**
 * Exchange the user's API key for a 15-minute single-use token via the
 * ElevenLabs token endpoint. Browsers can't set the `xi-api-key` header
 * on a WebSocket handshake, but they can on an HTTP POST, so we do this
 * round trip first and pass the resulting token as a query param to the
 * WebSocket. Throws with the HTTP status + response body on failure so
 * the recording controller can surface a useful message.
 */
async function mintSingleUseToken(
    apiKey: string,
    fetchFn: typeof fetch = globalThis.fetch,
): Promise<string> {
    let res: Response;
    try {
        res = await fetchFn(TOKEN_URL, {
            method: 'POST',
            headers: { 'xi-api-key': apiKey },
        });
    } catch (e) {
        throw new Error(
            `elevenlabs scribe realtime: token mint request failed: ${
                e instanceof Error ? e.message : String(e)
            }`,
        );
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
            `elevenlabs scribe realtime: token mint rejected (HTTP ${res.status}): ${body.slice(0, 200)}`,
        );
    }
    const data = (await res.json().catch(() => null)) as { token?: unknown } | null;
    if (!data || typeof data.token !== 'string') {
        throw new Error('elevenlabs scribe realtime: token mint returned no token field');
    }
    return data.token;
}

/**
 * Open a Scribe v2 Realtime session and resolve once the server has
 * acknowledged the connection with `session_started`. The returned
 * [`RealtimeSession`] hides the WebSocket lifecycle behind the three-call
 * contract shared by every realtime provider in this app.
 */
export async function connectScribeRealtime(
    opts: ConnectScribeRealtimeOpts,
): Promise<RealtimeSession> {
    const { modelId, apiKey, sampleRate, webSocketFactory, fetchFn } = opts;

    // The WebSocket can't carry the API key in a header, so trade it for a
    // single-use token first. A failed mint surfaces with a clear HTTP-
    // status error instead of the silent close-1000 we used to get when
    // the raw API key was passed as ?token=…
    const singleUseToken = await mintSingleUseToken(apiKey, fetchFn);

    const url = new URL(BASE_URL);
    url.searchParams.set('model_id', modelId);
    url.searchParams.set('audio_format', 'pcm_16000');
    url.searchParams.set('token', singleUseToken);

    const factory: WebSocketFactory = webSocketFactory ?? defaultWebSocketFactory;
    const ws = factory(url.toString());
    ws.binaryType = 'arraybuffer';

    // Buffer committed segments across the lifetime of the session. The
    // server emits one `committed_transcript` per finalized speech segment
    // (the per-chunk `commit: true` we send on `finish()` is also one).
    const segments: string[] = [];
    let finishResolve: ((text: string) => void) | null = null;
    let finishReject: ((err: Error) => void) | null = null;
    let finishExpected = false;
    let closed = false;
    let handshakeDone = false;

    const handshakeP = new Promise<void>((resolve, reject) => {
        const completeHandshake = () => {
            handshakeDone = true;
            resolve();
        };
        const failHandshake = (err: Error) => {
            if (!handshakeDone) {
                handshakeDone = true; // prevent double-reject from close-after-error
                reject(err);
            }
        };
        const onOpen = () => {
            // session_started follows immediately on open — wait for it
            // before declaring the session ready.
        };
        const onMessage = (ev: { data: string | ArrayBuffer }) => {
            // The server only sends JSON text frames.
            if (typeof ev.data !== 'string') return;
            const msg = parseMessage(ev.data);
            if (!msg) return;
            switch (msg.message_type) {
                case 'session_started':
                    completeHandshake();
                    break;
                case 'partial_transcript':
                    // Ignored under the "final only" paste design — kept here
                    // as a hook for future interim-UI features.
                    break;
                case 'committed_transcript':
                case 'committed_transcript_with_timestamps':
                    if (typeof msg.text === 'string') {
                        segments.push(msg.text);
                    }
                    if (finishExpected && finishResolve) {
                        finishResolve(segments.join(' ').trim());
                        finishResolve = null;
                    }
                    break;
                case 'error': {
                    const err = new Error(
                        `elevenlabs scribe realtime: ${msg.error ?? 'unknown error'}`,
                    );
                    if (finishReject) {
                        finishReject(err);
                        finishReject = null;
                    } else {
                        failHandshake(err);
                    }
                    break;
                }
            }
        };
        const onClose = (ev: { code?: number; reason?: string }) => {
            closed = true;
            if (!handshakeDone) {
                // Server closed before sending session_started. This is the
                // common "auth handshake rejected" path — without rejecting
                // here, `connect()` would hang forever and the recording
                // controller's `startFromIdle` would be stuck in idle with
                // no UI feedback. Surface a concrete error instead.
                const reason = ev.reason || `code ${ev.code ?? 'unknown'}`;
                failHandshake(
                    new Error(
                        `elevenlabs scribe realtime: websocket closed before session_started (${reason})`,
                    ),
                );
                return;
            }
            if (finishExpected && finishResolve) {
                // Server closed mid-session before we got a final commit
                // response — resolve with whatever segments we accumulated.
                finishResolve(segments.join(' ').trim());
                finishResolve = null;
            }
        };
        const onError = (ev: { message?: string } | Event) => {
            const msg =
                (ev as { message?: string }).message ?? 'websocket error before session_started';
            // Only surface to the handshake promise — once handshake is
            // done, error events are logged (a transport blip shouldn't
            // tear down an in-flight session that may still recover).
            if (!handshakeDone) {
                failHandshake(new Error(`elevenlabs scribe realtime: ${msg}`));
            } else {
                console.warn('elevenlabs scribe realtime: post-handshake ws error', msg);
            }
        };
        ws.addEventListener('open', onOpen);
        ws.addEventListener('message', onMessage);
        ws.addEventListener('close', onClose);
        ws.addEventListener('error', onError);
    });

    await handshakeP;

    return {
        sendAudio(pcm: Int16Array) {
            if (closed) return;
            const audio_base_64 = base64FromInt16(pcm);
            const frame = JSON.stringify({
                message_type: 'input_audio_chunk',
                audio_base_64,
                commit: false,
                sample_rate: sampleRate,
            });
            ws.send(frame);
        },
        async finish() {
            if (closed) {
                return segments.join(' ').trim();
            }
            finishExpected = true;
            const p = new Promise<string>((resolve, reject) => {
                finishResolve = resolve;
                finishReject = reject;
            });
            // Send an empty chunk with commit=true to force finalization.
            // (The docs allow either a final non-empty chunk with commit,
            // or an empty one — empty is simpler since we've already sent
            // all the audio via sendAudio.)
            ws.send(
                JSON.stringify({
                    message_type: 'input_audio_chunk',
                    audio_base_64: '',
                    commit: true,
                    sample_rate: sampleRate,
                }),
            );
            const text = await p;
            ws.close(1000, 'finish');
            closed = true;
            return text;
        },
        abort() {
            if (closed) return;
            closed = true;
            ws.close(1000, 'abort');
        },
    };
}

interface ScribeMessage {
    message_type: string;
    text?: string;
    error?: string;
}

function parseMessage(raw: string): ScribeMessage | null {
    try {
        return JSON.parse(raw) as ScribeMessage;
    } catch {
        return null;
    }
}

/**
 * Encode 16-bit little-endian mono PCM as base64. The Scribe Realtime
 * protocol wants raw PCM bytes, not the i16 array itself.
 */
function base64FromInt16(pcm: Int16Array): string {
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let binary = '';
    // Walk in chunks to avoid call-stack overflow on very large buffers —
    // `String.fromCharCode(...bytes)` blows up around 100 K args in some
    // engines. 0x8000 (32 K) is the standard safe stride.
    const STRIDE = 0x8000;
    for (let i = 0; i < bytes.length; i += STRIDE) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + STRIDE, bytes.length)));
    }
    return btoa(binary);
}

/**
 * Provider-shaped [`RealtimeModel`] for ElevenLabs Scribe v2 Realtime.
 * Closes over the API key so the provider config can pass it once via
 * `makeRealtimeModel(modelId, apiKey)` and let `connect()` resolve the
 * session.
 */
export function makeScribeRealtimeModel(modelId: string, apiKey: string): RealtimeModel {
    return {
        connect: ({ sampleRate }) => connectScribeRealtime({ modelId, apiKey, sampleRate }),
    };
}
