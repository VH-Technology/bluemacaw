/**
 * Shared WebSocket plumbing for realtime STT adapters
 * (ElevenLabs Scribe, Deepgram Flux, AssemblyAI streaming).
 *
 * Centralizes the `WebSocketLike` seam (so adapters are testable with an
 * in-memory mock) and the Tauri bridge. WKWebView refuses a native
 * `new WebSocket()` under the packaged app's custom `tauri://` document
 * origin (`SecurityError: The operation is insecure.`), so inside Tauri we
 * open the socket from the Rust side via `@tauri-apps/plugin-websocket`.
 *
 * Two capabilities the original (ElevenLabs-only) version lacked, both
 * needed by Deepgram Flux and AssemblyAI streaming:
 *   1. Binary frames — those providers stream raw PCM as binary WS
 *      messages, not base64-in-JSON. The Tauri bridge now forwards
 *      ArrayBuffer / typed-array sends as a byte array.
 *   2. Handshake auth via headers / subprotocols — Deepgram authenticates
 *      with `Authorization: Token <key>` (server-side) or the
 *      `Sec-WebSocket-Protocol: token, <key>` subprotocol (browser).
 */

import TauriWebSocket, { type Message as TauriWsMessage } from '@tauri-apps/plugin-websocket';

/**
 * Minimal `WebSocket`-shaped interface — exactly what the realtime adapters
 * call into. Lets tests inject a mock without requiring the full DOM type.
 */
export interface WebSocketLike {
    readonly readyState: number;
    binaryType: string;
    addEventListener: (
        type: 'open' | 'message' | 'close' | 'error',
        // biome-ignore lint/suspicious/noExplicitAny: WS event shapes vary by mock vs. native
        listener: (ev: any) => void,
    ) => void;
    send: (data: string | ArrayBuffer | ArrayBufferView) => void;
    close: (code?: number, reason?: string) => void;
}

export interface WebSocketConnectOpts {
    /**
     * Extra HTTP headers for the handshake. Only honored on the Tauri
     * (server-side) connect — browsers can't set handshake headers.
     */
    headers?: Record<string, string>;
    /**
     * WebSocket subprotocols — the browser-compatible auth channel (e.g.
     * Deepgram's `['token', '<key>']`). Honored on the native fallback.
     */
    protocols?: string[];
}

export type WebSocketFactory = (url: string, opts?: WebSocketConnectOpts) => WebSocketLike;

/**
 * Convert an outbound frame into the payload shape the Tauri websocket
 * plugin accepts: strings pass through as text frames; binary buffers
 * become a plain `number[]` the plugin sends as a binary frame. Exported
 * for unit testing the binary path without a live Tauri runtime.
 */
export function toTauriPayload(data: string | ArrayBuffer | ArrayBufferView): string | number[] {
    if (typeof data === 'string') return data;
    const view =
        data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(
                  (data as ArrayBufferView).buffer,
                  (data as ArrayBufferView).byteOffset,
                  (data as ArrayBufferView).byteLength,
              );
    return Array.from(view);
}

/**
 * Default WebSocket factory. Inside a Tauri runtime the socket is opened
 * from the Rust side via the websocket plugin; outside Tauri — a context we
 * don't actually ship, kept only as a safe dev fallback — it uses the
 * native WebSocket. Tests bypass this entirely via an injected factory.
 */
export const defaultWebSocketFactory: WebSocketFactory = (url, opts) => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    return inTauri
        ? tauriWebSocket(url, opts)
        : (new WebSocket(url, opts?.protocols) as unknown as WebSocketLike);
};

/**
 * Adapt the Tauri websocket plugin (async `connect`, single `addListener`
 * delivering typed frames) to the synchronous, native-`WebSocket`-shaped
 * [`WebSocketLike`] the session code expects. Listeners registered before
 * the async connect resolves are buffered and replayed; sends issued before
 * connect are queued.
 */
function tauriWebSocket(url: string, opts?: WebSocketConnectOpts): WebSocketLike {
    // biome-ignore lint/suspicious/noExplicitAny: event shapes mirror the native WS events the caller consumes
    type Listener = (ev: any) => void;
    const listeners: Record<'open' | 'message' | 'close' | 'error', Listener[]> = {
        open: [],
        message: [],
        close: [],
        error: [],
    };
    const emit = (type: keyof typeof listeners, ev: unknown) => {
        for (const l of listeners[type]) l(ev);
    };

    let conn: Awaited<ReturnType<typeof TauriWebSocket.connect>> | null = null;
    let state = 0; // CONNECTING
    const pending: Array<string | number[]> = [];

    TauriWebSocket.connect(url, opts?.headers ? { headers: opts.headers } : undefined)
        .then((c) => {
            conn = c;
            state = 1; // OPEN
            c.addListener((msg: TauriWsMessage) => {
                if (msg.type === 'Text') {
                    emit('message', { data: msg.data });
                } else if (msg.type === 'Binary') {
                    emit('message', { data: new Uint8Array(msg.data).buffer });
                } else if (msg.type === 'Close') {
                    state = 3; // CLOSED
                    emit('close', { code: msg.data?.code, reason: msg.data?.reason });
                }
            });
            for (const p of pending) void conn.send(p);
            pending.length = 0;
            emit('open', {});
        })
        .catch((e: unknown) => {
            state = 3;
            emit('error', { message: e instanceof Error ? e.message : String(e) });
        });

    return {
        get readyState() {
            return state;
        },
        binaryType: 'arraybuffer',
        addEventListener: (type, listener) => {
            listeners[type].push(listener);
        },
        send: (data) => {
            const payload = toTauriPayload(data);
            if (conn) void conn.send(payload);
            else pending.push(payload);
        },
        close: () => {
            state = 3;
            if (conn) void conn.disconnect();
        },
    };
}
