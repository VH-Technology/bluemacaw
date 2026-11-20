/**
 * WebSocket client for AssemblyAI Universal-3 Pro Streaming (v3)
 * (https://www.assemblyai.com/docs/api-reference/streaming-api/streaming-api).
 *
 * Wire protocol summary:
 * - A browser/WKWebView WebSocket can't set the `Authorization` header, so
 *   we follow AssemblyAI's documented client-side flow: GET a temporary
 *   token with the API key, then open the WS with `?token=<temp>`.
 *   (`GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=600`,
 *   header `Authorization: <API_KEY>` — raw key, no `Bearer` prefix.)
 * - URL: `wss://streaming.assemblyai.com/v3/ws` with query params
 *   `speech_model` (the streaming model id), `sample_rate`,
 *   `encoding=pcm_s16le`, `format_turns=true`, and `token`.
 * - On connect the server sends a `Begin` message; we gate the session on
 *   that (analogous to ElevenLabs' `session_started`).
 * - Audio: raw PCM16 LE mono sent as binary WS frames. A frame must hold
 *   20-1000 ms of audio (50-100 ms recommended); a shorter one is answered
 *   with error 3007 and the session is closed. The capture pipeline hands
 *   us one chunk per microphone callback (~10 ms), so chunks are batched
 *   into frames of at least 50 ms before they go out.
 * - Transcripts arrive as `Turn` messages, each carrying the whole text of
 *   its turn so far (`turn_order` identifies the turn). The latest message
 *   of a turn replaces the earlier ones; the session transcript is the
 *   turns joined in order.
 * - Errors arrive as an `Error` message followed by a close whose code is
 *   the error code. A session that ends that way with nothing transcribed
 *   fails `finish()` with the server's message rather than returning ''.
 * - End of stream: send `{ "type": "ForceEndpoint" }` to flush the current
 *   turn, then `{ "type": "Terminate" }`; the server replies with
 *   `Termination` and closes.
 */

import { httpFetch } from '../lib/http';
import { type WebSocketFactory, defaultWebSocketFactory } from './realtime-ws';
import type { RealtimeModel, RealtimeSession } from './types';

const BASE_URL = 'wss://streaming.assemblyai.com/v3/ws';
const TOKEN_URL = 'https://streaming.assemblyai.com/v3/token';
/** Shortest audio frame we send. The API minimum is 20 ms; it recommends 50-100. */
const MIN_FRAME_MS = 50;

export interface ConnectU3RealtimeOpts {
    modelId: string;
    apiKey: string;
    sampleRate: number;
    /** Injection seam for tests. Defaults to the shared Tauri-aware factory. */
    webSocketFactory?: WebSocketFactory;
    /** Injection seam for tests. Defaults to the Tauri-routed `httpFetch`. */
    fetchFn?: typeof fetch;
}

interface U3Message {
    type?: string;
    turn_order?: number;
    transcript?: string;
    end_of_turn?: boolean;
    error?: string;
    error_code?: number;
}

function parseMessage(raw: string): U3Message | null {
    try {
        return JSON.parse(raw) as U3Message;
    } catch {
        return null;
    }
}

/**
 * Exchange the API key for a short-lived streaming token. Mirrors the
 * ElevenLabs token-mint error handling so the recording controller can
 * surface a useful message (HTTP status + body, network failure, or a
 * malformed response) instead of a silent WS close.
 */
async function mintStreamingToken(
    apiKey: string,
    // Routed through the Tauri HTTP plugin by default to dodge webview CORS
    // (matching the batch AssemblyAI path); httpFetch falls back to the
    // global fetch outside Tauri, so injected test fetches still work.
    fetchFn: typeof fetch = httpFetch,
): Promise<string> {
    const url = `${TOKEN_URL}?expires_in_seconds=600`;
    let res: Response;
    try {
        res = await fetchFn(url, { method: 'GET', headers: { Authorization: apiKey } });
    } catch (e) {
        throw new Error(
            `assemblyai streaming: token mint request failed: ${
                e instanceof Error ? e.message : String(e)
            }`,
        );
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
            `assemblyai streaming: token mint rejected (HTTP ${res.status}): ${body.slice(0, 200)}`,
        );
    }
    const data = (await res.json().catch(() => null)) as { token?: unknown } | null;
    if (!data || typeof data.token !== 'string') {
        throw new Error('assemblyai streaming: token mint returned no token field');
    }
    return data.token;
}

/**
 * Open a Universal-3 Pro Streaming session and resolve once the server has
 * acknowledged with `Begin`. The returned [`RealtimeSession`] hides the
 * WebSocket lifecycle behind the three-call contract shared by every
 * realtime provider in this app.
 */
export async function connectU3Realtime(opts: ConnectU3RealtimeOpts): Promise<RealtimeSession> {
    const { modelId, apiKey, sampleRate, webSocketFactory, fetchFn } = opts;

    const token = await mintStreamingToken(apiKey, fetchFn);

    const url = new URL(BASE_URL);
    url.searchParams.set('speech_model', modelId);
    url.searchParams.set('sample_rate', String(sampleRate));
    url.searchParams.set('encoding', 'pcm_s16le');
    url.searchParams.set('format_turns', 'true');
    url.searchParams.set('token', token);

    const factory: WebSocketFactory = webSocketFactory ?? defaultWebSocketFactory;
    const ws = factory(url.toString());
    ws.binaryType = 'arraybuffer';

    /** Latest text of each turn, keyed by `turn_order`. */
    const turns = new Map<number, { text: string; final: boolean }>();
    /** Why the session ended, when it ended on anything but our own finish/abort. */
    let sessionError: Error | null = null;
    let finishSettle: { resolve: (text: string) => void; reject: (err: Error) => void } | null =
        null;
    let closed = false;
    let handshakeDone = false;
    /** The server acknowledged our `Terminate`; the close that follows is expected. */
    let terminated = false;

    const transcript = () =>
        [...turns.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, turn]) => turn.text)
            .join(' ')
            .trim();

    /**
     * What `finish()` reports: the transcript, or — when the session failed
     * before producing one — the failure. Text that did arrive is never
     * thrown away for an error that came after it.
     */
    const outcome = (): { text: string } | { error: Error } => {
        const text = transcript();
        if (text.length === 0 && sessionError) return { error: sessionError };
        return { text };
    };

    const settleFinish = () => {
        if (!finishSettle) return;
        const settle = finishSettle;
        finishSettle = null;
        const result = outcome();
        if ('error' in result) settle.reject(result.error);
        else settle.resolve(result.text);
    };

    const handshakeP = new Promise<void>((resolve, reject) => {
        const completeHandshake = () => {
            handshakeDone = true;
            resolve();
        };
        const failHandshake = (err: Error) => {
            if (!handshakeDone) {
                handshakeDone = true;
                reject(err);
            }
        };
        const onMessage = (ev: { data: string | ArrayBuffer }) => {
            if (typeof ev.data !== 'string') return;
            const msg = parseMessage(ev.data);
            if (!msg) return;
            switch (msg.type) {
                case 'Begin':
                    completeHandshake();
                    break;
                case 'Turn': {
                    if (typeof msg.transcript !== 'string' || msg.transcript.length === 0) break;
                    const order = typeof msg.turn_order === 'number' ? msg.turn_order : 0;
                    const final = msg.end_of_turn === true;
                    // A straggling partial must not undo a finalized turn.
                    if (turns.get(order)?.final && !final) break;
                    turns.set(order, { text: msg.transcript, final });
                    break;
                }
                case 'Termination':
                    terminated = true;
                    settleFinish();
                    break;
                case 'Error': {
                    const code = typeof msg.error_code === 'number' ? ` (${msg.error_code})` : '';
                    const err = new Error(
                        `assemblyai streaming: ${msg.error ?? 'unknown error'}${code}`,
                    );
                    if (!handshakeDone) {
                        failHandshake(err);
                        break;
                    }
                    sessionError = err;
                    console.warn('assemblyai streaming: session error', err.message);
                    settleFinish();
                    break;
                }
            }
        };
        const onClose = (ev: { code?: number; reason?: string }) => {
            if (closed) return;
            closed = true;
            const reason = ev.reason || `code ${ev.code ?? 'unknown'}`;
            if (!handshakeDone) {
                failHandshake(
                    new Error(`assemblyai streaming: websocket closed before Begin (${reason})`),
                );
                return;
            }
            if (terminated) return;
            // The server only closes on its own after an error or a timeout;
            // a normal end is the `Termination` we wait for in finish().
            sessionError ??= new Error(
                `assemblyai streaming: session closed by the server before it finished (${reason})`,
            );
            settleFinish();
        };
        const onError = (ev: { message?: string } | Event) => {
            const m = (ev as { message?: string }).message ?? 'websocket error before Begin';
            if (!handshakeDone) failHandshake(new Error(`assemblyai streaming: ${m}`));
            else console.warn('assemblyai streaming: post-handshake ws error', m);
        };
        ws.addEventListener('open', () => {
            // No-op: AssemblyAI signals readiness with the Begin message.
        });
        ws.addEventListener('message', onMessage);
        ws.addEventListener('close', onClose);
        ws.addEventListener('error', onError);
    });

    await handshakeP;

    const minFrameSamples = Math.ceil((sampleRate * MIN_FRAME_MS) / 1000);
    let buffered: Int16Array[] = [];
    let bufferedSamples = 0;

    /** Send everything buffered as one frame, zero-padded up to `padTo` samples. */
    const flushAudio = (padTo = 0) => {
        if (bufferedSamples === 0) return;
        const frame = new Int16Array(Math.max(bufferedSamples, padTo));
        let offset = 0;
        for (const chunk of buffered) {
            frame.set(chunk, offset);
            offset += chunk.length;
        }
        buffered = [];
        bufferedSamples = 0;
        ws.send(new Uint8Array(frame.buffer));
    };

    return {
        sendAudio(pcm: Int16Array) {
            if (closed) return;
            buffered.push(pcm);
            bufferedSamples += pcm.length;
            if (bufferedSamples >= minFrameSamples) flushAudio();
        },
        async finish() {
            if (!closed) {
                const settled = new Promise<string>((resolve, reject) => {
                    finishSettle = { resolve, reject };
                });
                // The tail is shorter than a valid frame; pad it with silence
                // instead of dropping the user's last few milliseconds.
                flushAudio(minFrameSamples);
                // Flush the in-flight turn, then ask the server to terminate.
                ws.send(JSON.stringify({ type: 'ForceEndpoint' }));
                ws.send(JSON.stringify({ type: 'Terminate' }));
                try {
                    return await settled;
                } finally {
                    if (!closed) {
                        closed = true;
                        ws.close(1000, 'finish');
                    }
                }
            }
            const result = outcome();
            if ('error' in result) throw result.error;
            return result.text;
        },
        abort() {
            if (closed) return;
            closed = true;
            ws.close(1000, 'abort');
        },
    };
}

/**
 * Provider-shaped [`RealtimeModel`] for AssemblyAI Universal-3 Pro
 * Streaming. Closes over the API key so the provider config can pass it
 * once via `makeRealtimeModel(modelId, apiKey)`.
 */
export function makeU3RealtimeModel(modelId: string, apiKey: string): RealtimeModel {
    return {
        connect: ({ sampleRate }) => connectU3Realtime({ modelId, apiKey, sampleRate }),
    };
}
