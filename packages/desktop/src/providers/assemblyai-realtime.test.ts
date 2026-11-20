// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { connectU3Realtime } from './assemblyai-realtime';
import type { WebSocketLike } from './realtime-ws';

class MockWebSocket implements WebSocketLike {
    readyState = 0;
    binaryType = 'arraybuffer';
    sentFrames: string[] = [];
    sentBinaryBytes: number[] = [];
    sendOrder: string[] = [];
    closedWith: { code?: number; reason?: string } | null = null;
    readonly url: string;
    private listeners: Record<string, Array<(ev: unknown) => void>> = {
        open: [],
        message: [],
        close: [],
        error: [],
    };

    constructor(url: string) {
        this.url = url;
    }

    addEventListener(type: 'open' | 'message' | 'close' | 'error', l: (ev: unknown) => void): void {
        this.listeners[type]?.push(l);
    }
    send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (typeof data === 'string') {
            this.sentFrames.push(data);
            this.sendOrder.push(JSON.parse(data).type);
        } else {
            this.sentBinaryBytes.push(data.byteLength);
            this.sendOrder.push('audio');
        }
    }
    /** The server ending the session on its own (error or timeout). */
    serverClose(code: number, reason = ''): void {
        this.readyState = 3;
        this.dispatch('close', { code, reason });
    }
    close(code?: number, reason?: string): void {
        this.closedWith = { code, reason };
        this.readyState = 3;
        this.dispatch('close', { code, reason });
    }
    serverMessage(payload: object): void {
        this.dispatch('message', { data: JSON.stringify(payload) });
    }
    private dispatch(type: string, ev: unknown): void {
        for (const l of this.listeners[type] ?? []) l(ev);
    }
}

function capturing(): {
    factory: (url: string) => WebSocketLike;
    socket: () => MockWebSocket;
    awaitSocket: () => Promise<MockWebSocket>;
} {
    let captured: MockWebSocket | null = null;
    return {
        factory: (url) => {
            captured = new MockWebSocket(url);
            return captured;
        },
        socket: () => {
            if (!captured) throw new Error('socket not yet created');
            return captured;
        },
        awaitSocket: async () => {
            for (let i = 0; i < 50; i++) {
                if (captured) return captured;
                await new Promise((r) => setTimeout(r, 0));
            }
            throw new Error('webSocketFactory was never called');
        },
    };
}

function fetchOk(token: string): typeof fetch {
    return (async () =>
        new Response(JSON.stringify({ token, expires_in_seconds: 600 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })) as typeof fetch;
}

async function openSession() {
    const { factory, awaitSocket } = capturing();
    const connectP = connectU3Realtime({
        modelId: 'u3-rt-pro',
        apiKey: 'k',
        sampleRate: 16000,
        webSocketFactory: factory,
        fetchFn: fetchOk('t'),
    });
    const sock = await awaitSocket();
    sock.serverMessage({ type: 'Begin' });
    return { sock, session: await connectP };
}

// One microphone callback at 48 kHz (512 frames) resampled to 16 kHz: ~10.7 ms.
const MIC_CALLBACK_SAMPLES = 171;
// AssemblyAI rejects frames under 20 ms (error 3007) and recommends 50-100 ms.
const MIN_FRAME_BYTES = 0.05 * 16000 * 2;

describe('connectU3Realtime', () => {
    it('mints a token then threads it + model into the v3 ws URL', async () => {
        const { factory, awaitSocket } = capturing();
        const fetchSpy = vi.fn(fetchOk('tmp-token-1'));
        const connectP = connectU3Realtime({
            modelId: 'u3-rt-pro',
            apiKey: 'aai-key',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchSpy,
        });
        const sock = await awaitSocket();
        sock.serverMessage({ type: 'Begin', id: 'abc', expires_at: 1 });
        await connectP;

        // Token mint: GET with the raw API key in Authorization (no Bearer).
        const [tokenUrl, init] = fetchSpy.mock.calls[0] ?? [];
        expect(String(tokenUrl)).toContain('https://streaming.assemblyai.com/v3/token');
        expect(String(tokenUrl)).toContain('expires_in_seconds=600');
        expect(init?.method).toBe('GET');
        expect((init?.headers as Record<string, string>).Authorization).toBe('aai-key');

        const url = new URL(sock.url);
        expect(url.origin + url.pathname).toBe('wss://streaming.assemblyai.com/v3/ws');
        expect(url.searchParams.get('speech_model')).toBe('u3-rt-pro');
        expect(url.searchParams.get('sample_rate')).toBe('16000');
        expect(url.searchParams.get('encoding')).toBe('pcm_s16le');
        expect(url.searchParams.get('format_turns')).toBe('true');
        expect(url.searchParams.get('token')).toBe('tmp-token-1');
    });

    it('waits for Begin before resolving connect()', async () => {
        const { factory, awaitSocket } = capturing();
        const connectP = connectU3Realtime({
            modelId: 'u3-rt-pro',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('t'),
        });
        const sock = await awaitSocket();
        let settled = false;
        connectP.then(() => {
            settled = true;
        });
        await new Promise((r) => setTimeout(r, 5));
        expect(settled).toBe(false);
        sock.serverMessage({ type: 'Begin' });
        await connectP;
        expect(settled).toBe(true);
    });

    it('sends audio as raw binary PCM frames (no JSON wrapping)', async () => {
        const { sock, session } = await openSession();
        session.sendAudio(new Int16Array(800)); // exactly 50 ms
        expect(sock.sentBinaryBytes).toEqual([1600]);
        expect(sock.sentFrames).toHaveLength(0);
    });

    // Regression: each microphone callback (~10 ms) used to go out as its own
    // frame. AssemblyAI answers a frame under 20 ms with error 3007 and ends
    // the session, which surfaced as a blank transcription.
    it('batches microphone-sized chunks into frames of at least 50 ms', async () => {
        const { sock, session } = await openSession();
        for (let i = 0; i < 4; i++) session.sendAudio(new Int16Array(MIC_CALLBACK_SAMPLES));
        expect(sock.sentBinaryBytes).toEqual([]);

        session.sendAudio(new Int16Array(MIC_CALLBACK_SAMPLES));
        expect(sock.sentBinaryBytes).toEqual([5 * MIC_CALLBACK_SAMPLES * 2]);
    });

    it('never sends a frame shorter than 50 ms, and loses no audio', async () => {
        const { sock, session } = await openSession();
        for (let i = 0; i < 100; i++) session.sendAudio(new Int16Array(MIC_CALLBACK_SAMPLES));
        expect(sock.sentBinaryBytes.length).toBeGreaterThan(0);
        for (const bytes of sock.sentBinaryBytes) {
            expect(bytes).toBeGreaterThanOrEqual(MIN_FRAME_BYTES);
        }
        expect(sock.sentBinaryBytes.reduce((a, b) => a + b, 0)).toBe(
            100 * MIC_CALLBACK_SAMPLES * 2,
        );
    });

    it('preserves sample order and values across batched chunks', async () => {
        const { factory, awaitSocket } = capturing();
        const connectP = connectU3Realtime({
            modelId: 'u3-rt-pro',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('t'),
        });
        const sock = await awaitSocket();
        const frames: number[][] = [];
        sock.send = (data) => {
            if (typeof data !== 'string') {
                const view = data as ArrayBufferView;
                frames.push(
                    Array.from(new Int16Array(view.buffer, view.byteOffset, view.byteLength / 2)),
                );
            }
        };
        sock.serverMessage({ type: 'Begin' });
        const session = await connectP;

        const first = Int16Array.from({ length: 500 }, (_, i) => i);
        const second = Int16Array.from({ length: 500 }, (_, i) => 500 + i);
        session.sendAudio(first);
        session.sendAudio(second);
        expect(frames).toEqual([Array.from({ length: 1000 }, (_, i) => i)]);
    });

    it('finish() flushes the buffered tail as a valid frame before terminating', async () => {
        const { sock, session } = await openSession();
        session.sendAudio(new Int16Array(100)); // 6 ms left over
        const finishP = session.finish();
        // Padded with silence up to 50 ms rather than sent as a 6 ms frame.
        expect(sock.sentBinaryBytes).toEqual([MIN_FRAME_BYTES]);
        expect(sock.sendOrder).toEqual(['audio', 'ForceEndpoint', 'Terminate']);
        sock.serverMessage({ type: 'Termination' });
        await finishP;
    });

    it('finish() sends no audio frame when nothing is buffered', async () => {
        const { sock, session } = await openSession();
        const finishP = session.finish();
        expect(sock.sendOrder).toEqual(['ForceEndpoint', 'Terminate']);
        sock.serverMessage({ type: 'Termination' });
        await finishP;
    });

    it('finish() sends ForceEndpoint + Terminate and resolves on Termination', async () => {
        const { factory, awaitSocket } = capturing();
        const connectP = connectU3Realtime({
            modelId: 'u3-rt-pro',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('t'),
        });
        const sock = await awaitSocket();
        sock.serverMessage({ type: 'Begin' });
        const session = await connectP;

        // An unformatted final, then the formatted version (only formatted counts).
        sock.serverMessage({
            type: 'Turn',
            turn_order: 0,
            transcript: 'hello world',
            end_of_turn: true,
            turn_is_formatted: false,
        });
        sock.serverMessage({
            type: 'Turn',
            turn_order: 0,
            transcript: 'Hello world.',
            end_of_turn: true,
            turn_is_formatted: true,
        });

        const finishP = session.finish();
        const frames = sock.sentFrames.map((f) => JSON.parse(f).type);
        expect(frames).toContain('ForceEndpoint');
        expect(frames).toContain('Terminate');

        sock.serverMessage({ type: 'Termination', audio_duration_seconds: 1 });
        await expect(finishP).resolves.toBe('Hello world.');
        expect(sock.closedWith?.reason).toBe('finish');
    });

    it('finish() resolves with accumulated text if the server closes early', async () => {
        const { factory, awaitSocket } = capturing();
        const connectP = connectU3Realtime({
            modelId: 'u3-rt-pro',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('t'),
        });
        const sock = await awaitSocket();
        sock.serverMessage({ type: 'Begin' });
        const session = await connectP;
        sock.serverMessage({
            type: 'Turn',
            transcript: 'Partial.',
            end_of_turn: true,
            turn_is_formatted: true,
        });

        const finishP = session.finish();
        sock.close(1011, 'server-error');
        await expect(finishP).resolves.toBe('Partial.');
    });

    it('joins the turns of a session in order', async () => {
        const { sock, session } = await openSession();
        const turn = (turn_order: number, transcript: string, final: boolean) =>
            sock.serverMessage({
                type: 'Turn',
                turn_order,
                transcript,
                end_of_turn: final,
                turn_is_formatted: final,
            });
        turn(0, 'hello', false);
        turn(0, 'Hello there.', true);
        turn(1, 'how are', false);
        turn(1, 'How are you?', true);
        const finishP = session.finish();
        sock.serverMessage({ type: 'Termination' });
        await expect(finishP).resolves.toBe('Hello there. How are you?');
    });

    it('keeps a final turn that the server did not flag as formatted', async () => {
        const { sock, session } = await openSession();
        sock.serverMessage({
            type: 'Turn',
            turn_order: 0,
            transcript: 'hello world',
            end_of_turn: true,
            turn_is_formatted: false,
        });
        const finishP = session.finish();
        sock.serverMessage({ type: 'Termination' });
        await expect(finishP).resolves.toBe('hello world');
    });

    it('keeps the words of a turn the server never finalized', async () => {
        const { sock, session } = await openSession();
        sock.serverMessage({
            type: 'Turn',
            turn_order: 0,
            transcript: 'still talking when',
            end_of_turn: false,
            turn_is_formatted: false,
        });
        const finishP = session.finish();
        sock.serverMessage({ type: 'Termination' });
        await expect(finishP).resolves.toBe('still talking when');
    });

    it('does not let a late partial replace a finalized turn', async () => {
        const { sock, session } = await openSession();
        const send = (transcript: string, final: boolean) =>
            sock.serverMessage({
                type: 'Turn',
                turn_order: 0,
                transcript,
                end_of_turn: final,
                turn_is_formatted: final,
            });
        send('Hello world.', true);
        send('hello', false);
        const finishP = session.finish();
        sock.serverMessage({ type: 'Termination' });
        await expect(finishP).resolves.toBe('Hello world.');
    });

    // Regression: a server error after the handshake was only logged, and
    // finish() then resolved with '' — pasted and saved as a blank
    // transcription with no hint of what went wrong.
    it('finish() rejects with the server error when the session died without a transcript', async () => {
        const { sock, session } = await openSession();
        sock.serverMessage({
            type: 'Error',
            error_code: 3007,
            error: 'Input duration violation: 10.7 ms. Expected between 20 and 1000 ms',
        });
        sock.serverClose(3007);
        await expect(session.finish()).rejects.toThrow(/Input duration violation/);
    });

    it('finish() rejects when the server closed the session early with no transcript', async () => {
        const { sock, session } = await openSession();
        sock.serverClose(1011, 'internal error');
        await expect(session.finish()).rejects.toThrow(/closed.*1011|internal error/i);
    });

    it('finish() rejects when the server errors instead of terminating', async () => {
        const { sock, session } = await openSession();
        const finishP = session.finish();
        sock.serverMessage({ type: 'Error', error_code: 3006, error: 'Invalid speech_model' });
        sock.serverClose(3006);
        await expect(finishP).rejects.toThrow(/Invalid speech_model/);
    });

    it('finish() still returns what was transcribed before a server error', async () => {
        const { sock, session } = await openSession();
        sock.serverMessage({
            type: 'Turn',
            turn_order: 0,
            transcript: 'Got this far.',
            end_of_turn: true,
            turn_is_formatted: true,
        });
        sock.serverMessage({ type: 'Error', error_code: 3005, error: 'Session expired' });
        sock.serverClose(3005);
        await expect(session.finish()).resolves.toBe('Got this far.');
    });

    it('finish() resolves with an empty string when the user simply said nothing', async () => {
        const { sock, session } = await openSession();
        const finishP = session.finish();
        sock.serverMessage({ type: 'Termination' });
        await expect(finishP).resolves.toBe('');
    });

    it('rejects connect() when the socket closes before Begin', async () => {
        const { factory, awaitSocket } = capturing();
        const connectP = connectU3Realtime({
            modelId: 'u3-rt-pro',
            apiKey: 'bad',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('t'),
        });
        (await awaitSocket()).close(1006, 'unauthorized');
        await expect(connectP).rejects.toThrow(/closed before Begin.*unauthorized/);
    });

    it('surfaces token-mint HTTP errors with status + body', async () => {
        const failingFetch = (async () =>
            new Response('Invalid API key', { status: 401 })) as typeof fetch;
        const { factory } = capturing();
        await expect(
            connectU3Realtime({
                modelId: 'u3-rt-pro',
                apiKey: 'bad',
                sampleRate: 16000,
                webSocketFactory: factory,
                fetchFn: failingFetch,
            }),
        ).rejects.toThrow(/token mint rejected.*HTTP 401.*Invalid API key/);
    });

    it('rejects when the token-mint response is missing the token field', async () => {
        const malformed = (async () =>
            new Response(JSON.stringify({ nope: 1 }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })) as typeof fetch;
        const { factory } = capturing();
        await expect(
            connectU3Realtime({
                modelId: 'u3-rt-pro',
                apiKey: 'k',
                sampleRate: 16000,
                webSocketFactory: factory,
                fetchFn: malformed,
            }),
        ).rejects.toThrow(/returned no token field/);
    });

    it('abort() closes the socket without finalizing', async () => {
        const { factory, awaitSocket } = capturing();
        const connectP = connectU3Realtime({
            modelId: 'u3-rt-pro',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('t'),
        });
        const sock = await awaitSocket();
        sock.serverMessage({ type: 'Begin' });
        const session = await connectP;
        session.abort();
        expect(sock.closedWith?.reason).toBe('abort');
    });
});
