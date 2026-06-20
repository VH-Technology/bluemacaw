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
 * - Audio: raw PCM16 LE mono sent as binary WS frames — exactly the
 *   `Int16Array` the `RealtimeSession.sendAudio` contract produces.
 * - Transcripts arrive as `Turn` messages. With `format_turns=true` the
 *   final, punctuated text for a turn is the `Turn` where `end_of_turn`
 *   and `turn_is_formatted` are both true; we accumulate those across the
 *   session and join them.
 * - End of stream: send `{ "type": "ForceEndpoint" }` to flush the current
 *   turn, then `{ "type": "Terminate" }`; the server replies with
 *   `Termination` and closes.
 */

import { httpFetch } from '../lib/http';
import { type WebSocketFactory, defaultWebSocketFactory } from './realtime-ws';
import type { RealtimeModel, RealtimeSession } from './types';

const BASE_URL = 'wss://streaming.assemblyai.com/v3/ws';
const TOKEN_URL = 'https://streaming.assemblyai.com/v3/token';

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
    transcript?: string;
    end_of_turn?: boolean;
    turn_is_formatted?: boolean;
    error?: string;
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
                case 'Turn':
                    // Only the formatted, finalized turn text feeds the paste.
                    if (
                        msg.end_of_turn === true &&
                        msg.turn_is_formatted === true &&
                        typeof msg.transcript === 'string' &&
                        msg.transcript.length > 0
                    ) {
                        segments.push(msg.transcript);
                    }
                    break;
                case 'Termination':
                    if (finishExpected && finishResolve) {
                        finishResolve(segments.join(' ').trim());
                        finishResolve = null;
                    }
                    break;
                case 'Error': {
                    const err = new Error(`assemblyai streaming: ${msg.error ?? 'unknown error'}`);
                    if (!handshakeDone) failHandshake(err);
                    else console.warn('assemblyai streaming: post-handshake error', err.message);
                    break;
                }
            }
        };
        const onClose = (ev: { code?: number; reason?: string }) => {
            closed = true;
            if (!handshakeDone) {
                const reason = ev.reason || `code ${ev.code ?? 'unknown'}`;
                failHandshake(
                    new Error(`assemblyai streaming: websocket closed before Begin (${reason})`),
                );
                return;
            }
            if (finishExpected && finishResolve) {
                finishResolve(segments.join(' ').trim());
                finishResolve = null;
            }
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

    return {
        sendAudio(pcm: Int16Array) {
            if (closed) return;
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
            // Flush the in-flight turn, then ask the server to terminate.
            ws.send(JSON.stringify({ type: 'ForceEndpoint' }));
            ws.send(JSON.stringify({ type: 'Terminate' }));
            const text = await p;
            if (!closed) {
                ws.close(1000, 'finish');
                closed = true;
            }
            return text;
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
