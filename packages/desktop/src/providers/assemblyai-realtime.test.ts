// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { connectU3Realtime } from './assemblyai-realtime';
import type { WebSocketLike } from './realtime-ws';

class MockWebSocket implements WebSocketLike {
    readyState = 0;
    binaryType = 'arraybuffer';
    sentFrames: string[] = [];
    sentBinaryBytes: number[] = [];
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
        if (typeof data === 'string') this.sentFrames.push(data);
        else this.sentBinaryBytes.push(data.byteLength);
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

    it('sendAudio emits raw binary PCM frames (no JSON wrapping)', async () => {
        const { factory, awaitSocket } = capturing();
        const connectP = connectU3Realtime({
            modelId: 'u3-rt-pro',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
            fetchFn: fetchOk('t'),
        });
        (await awaitSocket()).serverMessage({ type: 'Begin' });
        const session = await connectP;

        session.sendAudio(new Int16Array([1, 2, 3, 4])); // 8 bytes
        const sock = await awaitSocket();
        expect(sock.sentBinaryBytes).toEqual([8]);
        expect(sock.sentFrames).toHaveLength(0);
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
            transcript: 'hello world',
            end_of_turn: true,
            turn_is_formatted: false,
        });
        sock.serverMessage({
            type: 'Turn',
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
