// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
    type ConnectScribeRealtimeOpts,
    type WebSocketLike,
    connectScribeRealtime,
} from './elevenlabs-realtime';

/**
 * Minimal in-memory WebSocket double. We don't need real socket plumbing —
 * the adapter only touches the event/send/close surface, so a recorder
 * for outbound frames + a hand-driven inbound queue is enough.
 */
class MockWebSocket implements WebSocketLike {
    readyState = 1;
    binaryType = 'arraybuffer';
    sentFrames: string[] = [];
    closedWith: { code?: number; reason?: string } | null = null;
    private listeners: Record<string, Array<(ev: unknown) => void>> = {
        open: [],
        message: [],
        close: [],
        error: [],
    };
    readonly url: string;

    constructor(url: string) {
        this.url = url;
    }

    addEventListener(
        type: 'open' | 'message' | 'close' | 'error',
        listener: (ev: unknown) => void,
    ): void {
        const bucket = this.listeners[type];
        if (!bucket) throw new Error(`unknown event type ${type}`);
        bucket.push(listener);
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (typeof data === 'string') {
            this.sentFrames.push(data);
        } else {
            this.sentFrames.push(`<binary:${(data as ArrayBuffer).byteLength}>`);
        }
    }

    close(code?: number, reason?: string): void {
        this.closedWith = { code, reason };
        this.readyState = 3;
        this.dispatch('close', { code, reason });
    }

    /** Test helper: push a JSON message in from the "server". */
    serverMessage(payload: object): void {
        this.dispatch('message', { data: JSON.stringify(payload) });
    }

    /** Test helper: simulate a transport-level error. */
    serverError(message: string): void {
        this.dispatch('error', { message });
    }

    private dispatch(type: string, ev: unknown): void {
        for (const l of this.listeners[type] ?? []) {
            l(ev);
        }
    }
}

function makeFactoryThatCaptures(): {
    factory: ConnectScribeRealtimeOpts['webSocketFactory'];
    socket: () => MockWebSocket;
    awaitSocket: () => Promise<MockWebSocket>;
} {
    let captured: MockWebSocket | null = null;
    return {
        factory: (url: string) => {
            captured = new MockWebSocket(url);
            return captured;
        },
        socket: () => {
            if (!captured) throw new Error('socket not yet created');
            return captured;
        },
        // Yield microtasks until the factory has been called. Needed because
        // `connectScribeRealtime` now awaits a token-mint HTTP call before
        // it ever constructs the WebSocket — driving the server side
        // synchronously after `connectScribeRealtime(...)` would hit a
        // "socket not yet created" race.
        awaitSocket: async () => {
            for (let i = 0; i < 50; i++) {
                if (captured) return captured;
                await new Promise((r) => setTimeout(r, 0));
            }
            throw new Error('webSocketFactory was never called');
        },
    };
}

/** Fetch mock that resolves to a token-mint success response. */
function fetchOk(token: string): typeof fetch {
    const fn = async (..._args: Parameters<typeof fetch>) =>
        new Response(JSON.stringify({ token }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    return fn as typeof fetch;
}

describe('connectScribeRealtime', () => {
    it('mints a single-use token and threads it through the websocket URL', async () => {
        const { factory, awaitSocket } = makeFactoryThatCaptures();
        const fetchSpy = vi.fn(fetchOk('single-use-12345'));
        const connectP = connectScribeRealtime({
            modelId: 'scribe_v2_realtime',
            apiKey: 'sk-test',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchSpy,
        });
        const sock = await awaitSocket();
        sock.serverMessage({ message_type: 'session_started' });
        await connectP;

        // The HTTP call is POST to the documented token endpoint with the
        // API key in the xi-api-key header.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [tokenUrl, init] = fetchSpy.mock.calls[0] ?? [];
        expect(tokenUrl).toBe('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe');
        expect(init?.method).toBe('POST');
        expect((init?.headers as Record<string, string>)['xi-api-key']).toBe('sk-test');

        // The WebSocket URL carries the MINTED token, not the API key — that
        // was the bug that caused silent close-1000 rejections.
        const url = new URL(sock.url);
        expect(url.origin + url.pathname).toBe(
            'wss://api.elevenlabs.io/v1/speech-to-text/realtime',
        );
        expect(url.searchParams.get('model_id')).toBe('scribe_v2_realtime');
        expect(url.searchParams.get('audio_format')).toBe('pcm_16000');
        expect(url.searchParams.get('token')).toBe('single-use-12345');
    });

    it('waits for session_started before resolving connect()', async () => {
        const { factory, awaitSocket } = makeFactoryThatCaptures();
        const connectP = connectScribeRealtime({
            modelId: 'scribe_v2_realtime',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('tok'),
        });
        const sock = await awaitSocket();
        // Don't push session_started yet — make sure connectP hasn't resolved.
        let settled = false;
        connectP.then(() => {
            settled = true;
        });
        await new Promise((r) => setTimeout(r, 5));
        expect(settled).toBe(false);

        sock.serverMessage({ message_type: 'session_started' });
        await connectP;
        expect(settled).toBe(true);
    });

    it('sendAudio emits an input_audio_chunk frame with base64 PCM and commit:false', async () => {
        const { factory, awaitSocket, socket } = makeFactoryThatCaptures();
        const connectP = connectScribeRealtime({
            modelId: 'scribe_v2_realtime',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('tok'),
        });
        (await awaitSocket()).serverMessage({ message_type: 'session_started' });
        const session = await connectP;

        // 4 i16 samples → 8 bytes → 12 base64 chars (no padding for multiples of 3 bytes; 8 → 12 with padding).
        const pcm = new Int16Array([1, 2, 3, 4]);
        session.sendAudio(pcm);

        expect(socket().sentFrames).toHaveLength(1);
        const frame = JSON.parse(socket().sentFrames[0] ?? '');
        expect(frame.message_type).toBe('input_audio_chunk');
        expect(frame.commit).toBe(false);
        expect(frame.sample_rate).toBe(16000);
        // Decode and verify the PCM round-trips byte-exact.
        const decoded = Uint8Array.from(atob(frame.audio_base_64), (c) => c.charCodeAt(0));
        expect(decoded.byteLength).toBe(8);
        const roundTripped = new Int16Array(
            decoded.buffer,
            decoded.byteOffset,
            decoded.byteLength / 2,
        );
        expect(Array.from(roundTripped)).toEqual([1, 2, 3, 4]);
    });

    it('finish() sends commit:true and resolves with the concatenated committed text', async () => {
        const { factory, socket, awaitSocket } = makeFactoryThatCaptures();
        const connectP = connectScribeRealtime({
            modelId: 'scribe_v2_realtime',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('tok'),
        });
        (await awaitSocket()).serverMessage({ message_type: 'session_started' });
        const session = await connectP;

        // Server emits an interim committed segment mid-utterance (VAD path)
        // before our explicit commit. Both should make it into the final.
        socket().serverMessage({
            message_type: 'committed_transcript',
            text: 'hello',
        });

        const finishP = session.finish();
        // Last frame sent should be the explicit-commit chunk.
        const lastFrame = JSON.parse(socket().sentFrames.at(-1) ?? '{}');
        expect(lastFrame.message_type).toBe('input_audio_chunk');
        expect(lastFrame.commit).toBe(true);

        socket().serverMessage({
            message_type: 'committed_transcript',
            text: 'world',
        });

        const text = await finishP;
        expect(text).toBe('hello world');
        // Should have cleanly closed the socket.
        expect(socket().closedWith?.reason).toBe('finish');
    });

    it('abort() closes the socket without finalising', async () => {
        const { factory, socket, awaitSocket } = makeFactoryThatCaptures();
        const connectP = connectScribeRealtime({
            modelId: 'scribe_v2_realtime',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('tok'),
        });
        (await awaitSocket()).serverMessage({ message_type: 'session_started' });
        const session = await connectP;

        session.abort();
        expect(socket().closedWith?.reason).toBe('abort');
        // sendAudio after abort is a no-op (no thrown error, no extra frame).
        const framesBefore = socket().sentFrames.length;
        session.sendAudio(new Int16Array([1, 2, 3]));
        expect(socket().sentFrames.length).toBe(framesBefore);
    });

    it('rejects connect() when the server closes the websocket before session_started', async () => {
        // Common real-world case: HTTP-stage auth rejection. WS closes
        // without ever sending session_started and (depending on browser
        // impl) often without an `error` event. The handshake promise
        // must NOT hang silently in that case.
        const { factory, awaitSocket } = makeFactoryThatCaptures();
        const connectP = connectScribeRealtime({
            modelId: 'scribe_v2_realtime',
            apiKey: 'bad',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('tok'),
        });
        (await awaitSocket()).close(1006, 'unauthorized');

        await expect(connectP).rejects.toThrow(/closed before session_started.*unauthorized/);
    });

    it('rejects connect() when the server sends an error before session_started', async () => {
        const { factory, awaitSocket } = makeFactoryThatCaptures();
        const connectP = connectScribeRealtime({
            modelId: 'scribe_v2_realtime',
            apiKey: 'bad',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('tok'),
        });
        (await awaitSocket()).serverMessage({
            message_type: 'error',
            error: 'auth_error',
        });

        await expect(connectP).rejects.toThrow(/auth_error/);
    });

    it('finish() resolves with accumulated text if the server closes early', async () => {
        const { factory, socket, awaitSocket } = makeFactoryThatCaptures();
        const connectP = connectScribeRealtime({
            modelId: 'scribe_v2_realtime',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('tok'),
        });
        (await awaitSocket()).serverMessage({ message_type: 'session_started' });
        const session = await connectP;

        socket().serverMessage({
            message_type: 'committed_transcript',
            text: 'partial',
        });

        const finishP = session.finish();
        // Server closes before responding to the commit frame.
        socket().close(1011, 'server-error');

        await expect(finishP).resolves.toBe('partial');
    });

    it('surfaces token-mint HTTP errors with status + body', async () => {
        // 401 is the common case — invalid API key. The error message must
        // make that obvious so the recording-controller's error pill helps
        // the user instead of saying "websocket closed before…".
        const failingFetch = (async () =>
            new Response('Invalid API key', { status: 401 })) as typeof fetch;
        const { factory } = makeFactoryThatCaptures();
        await expect(
            connectScribeRealtime({
                modelId: 'scribe_v2_realtime',
                apiKey: 'bad',
                sampleRate: 16000,
                webSocketFactory: factory,
                fetchFn: failingFetch,
            }),
        ).rejects.toThrow(/token mint rejected.*HTTP 401.*Invalid API key/);
    });

    it('surfaces token-mint network errors clearly', async () => {
        const networkErrorFetch = (async () => {
            throw new Error('Failed to fetch');
        }) as typeof fetch;
        const { factory } = makeFactoryThatCaptures();
        await expect(
            connectScribeRealtime({
                modelId: 'scribe_v2_realtime',
                apiKey: 'k',
                sampleRate: 16000,
                webSocketFactory: factory,
                fetchFn: networkErrorFetch,
            }),
        ).rejects.toThrow(/token mint request failed.*Failed to fetch/);
    });

    it('rejects when the token-mint response is missing the token field', async () => {
        const malformedFetch = (async () =>
            new Response(JSON.stringify({ unexpected: 'shape' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })) as typeof fetch;
        const { factory } = makeFactoryThatCaptures();
        await expect(
            connectScribeRealtime({
                modelId: 'scribe_v2_realtime',
                apiKey: 'k',
                sampleRate: 16000,
                webSocketFactory: factory,
                fetchFn: malformedFetch,
            }),
        ).rejects.toThrow(/returned no token field/);
    });
});
