/**
 * WebSocket client for Deepgram Flux (v2)
 * (https://developers.deepgram.com/reference/speech-to-text/listen-flux).
 *
 * Wire protocol summary:
 * - URL: `wss://api.deepgram.com/v2/listen` (Flux is the v2 endpoint — it
 *   does NOT run on v1) with query params `model`, `encoding=linear16`,
 *   `sample_rate`.
 * - Auth: Deepgram accepts `Authorization: Token <key>` on the handshake.
 *   The Tauri websocket plugin opens the socket Rust-side and can set that
 *   header directly (no token-mint round trip needed, unlike ElevenLabs).
 *   For the non-Tauri dev fallback we also pass the browser-compatible
 *   `Sec-WebSocket-Protocol: token, <key>` subprotocol.
 * - Audio: raw linear16 (16-bit LE mono PCM) sent as binary WS frames —
 *   exactly the `Int16Array` the `RealtimeSession.sendAudio` contract
 *   produces. No base64/JSON wrapping (that's the ElevenLabs shape).
 * - Flux is turn-based: the server streams `TurnInfo` messages whose
 *   `event` field walks a state machine (`StartOfTurn`, `Update`,
 *   `EagerEndOfTurn`, `TurnResumed`, `EndOfTurn`). The finalized transcript
 *   for a turn arrives on `EndOfTurn`; we accumulate those across the
 *   session and join them (mirrors how the ElevenLabs adapter concatenates
 *   `committed_transcript`s). Interim/eager events are ignored for the
 *   final paste.
 * - End of stream: send JSON `{ "type": "CloseStream" }`; Flux flushes any
 *   remaining `TurnInfo` responses and then closes the socket.
 */

import { type WebSocketFactory, defaultWebSocketFactory } from './realtime-ws';
import type { RealtimeModel, RealtimeSession } from './types';

const BASE_URL = 'wss://api.deepgram.com/v2/listen';

export interface ConnectFluxRealtimeOpts {
    modelId: string;
    apiKey: string;
    sampleRate: number;
    /** Injection seam for tests. Defaults to the shared Tauri-aware factory. */
    webSocketFactory?: WebSocketFactory;
}

interface FluxMessage {
    type?: string;
    event?: string;
    transcript?: string;
    description?: string;
}

function parseMessage(raw: string): FluxMessage | null {
    try {
        return JSON.parse(raw) as FluxMessage;
    } catch {
        return null;
    }
}

/**
 * Open a Flux session and resolve once the socket handshake is open. The
 * returned [`RealtimeSession`] hides the WebSocket lifecycle behind the
 * three-call contract shared by every realtime provider in this app.
 */
export async function connectFluxRealtime(opts: ConnectFluxRealtimeOpts): Promise<RealtimeSession> {
    const { modelId, apiKey, sampleRate, webSocketFactory } = opts;

    const url = new URL(BASE_URL);
    url.searchParams.set('model', modelId);
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', String(sampleRate));

    const factory: WebSocketFactory = webSocketFactory ?? defaultWebSocketFactory;
    const ws = factory(url.toString(), {
        headers: { Authorization: `Token ${apiKey}` },
        protocols: ['token', apiKey],
    });
    ws.binaryType = 'arraybuffer';

    const segments: string[] = [];
    let finishResolve: ((text: string) => void) | null = null;
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
            // Flux lets us start streaming audio as soon as the socket is
            // open — there's no app-level "session ready" ack to wait for.
            completeHandshake();
        };
        const onMessage = (ev: { data: string | ArrayBuffer }) => {
            if (typeof ev.data !== 'string') return;
            const msg = parseMessage(ev.data);
            if (!msg) return;
            if (msg.type === 'TurnInfo') {
                // Only the finalized turn transcript counts toward the paste.
                // Update / EagerEndOfTurn / TurnResumed / StartOfTurn are
                // interim or speculative and are intentionally ignored.
                if (
                    msg.event === 'EndOfTurn' &&
                    typeof msg.transcript === 'string' &&
                    msg.transcript.length > 0
                ) {
                    segments.push(msg.transcript);
                }
            } else if (msg.type === 'Error') {
                const err = new Error(`deepgram flux: ${msg.description ?? 'unknown error'}`);
                if (!handshakeDone) failHandshake(err);
                else console.warn('deepgram flux: post-handshake error', err.message);
            }
        };
        const onClose = (ev: { code?: number; reason?: string }) => {
            closed = true;
            if (!handshakeDone) {
                // Socket closed before opening — the common auth-rejection
                // path. Surface a concrete error instead of hanging connect().
                const reason = ev.reason || `code ${ev.code ?? 'unknown'}`;
                failHandshake(
                    new Error(`deepgram flux: websocket closed before connect (${reason})`),
                );
                return;
            }
            // Flux closes after flushing remaining turns in response to
            // CloseStream — resolve finish() with everything accumulated.
            if (finishExpected && finishResolve) {
                finishResolve(segments.join(' ').trim());
                finishResolve = null;
            }
        };
        const onError = (ev: { message?: string } | Event) => {
            const m = (ev as { message?: string }).message ?? 'websocket error before connect';
            if (!handshakeDone) failHandshake(new Error(`deepgram flux: ${m}`));
            else console.warn('deepgram flux: post-handshake ws error', m);
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
            // Flux wants raw linear16 bytes as a binary frame.
            ws.send(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
        },
        async finish() {
            if (closed) {
                return segments.join(' ').trim();
            }
            finishExpected = true;
            const p = new Promise<string>((resolve) => {
                finishResolve = resolve;
            });
            // Ask Flux to flush remaining turns and close the stream.
            ws.send(JSON.stringify({ type: 'CloseStream' }));
            return p;
        },
        abort() {
            if (closed) return;
            closed = true;
            ws.close(1000, 'abort');
        },
    };
}

/**
 * Provider-shaped [`RealtimeModel`] for Deepgram Flux. Closes over the API
 * key so the provider config can pass it once via
 * `makeRealtimeModel(modelId, apiKey)`.
 */
export function makeFluxRealtimeModel(modelId: string, apiKey: string): RealtimeModel {
    return {
        connect: ({ sampleRate }) => connectFluxRealtime({ modelId, apiKey, sampleRate }),
    };
}
