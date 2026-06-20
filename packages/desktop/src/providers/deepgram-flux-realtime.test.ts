// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { connectFluxRealtime } from './deepgram-flux-realtime';
import type { WebSocketConnectOpts, WebSocketLike } from './realtime-ws';

/**
 * In-memory WebSocket double. Records outbound frames (binary recorded as a
 * `<binary:N>` marker, like the ElevenLabs test) and lets the test drive
 * inbound open/message/close/error events by hand.
 */
class MockWebSocket implements WebSocketLike {
    readyState = 0;
    binaryType = 'arraybuffer';
    sentFrames: string[] = [];
    sentBinaryBytes: number[] = [];
    closedWith: { code?: number; reason?: string } | null = null;
    readonly url: string;
    readonly opts?: WebSocketConnectOpts;
    private listeners: Record<string, Array<(ev: unknown) => void>> = {
        open: [],
        message: [],
        close: [],
        error: [],
    };

    constructor(url: string, opts?: WebSocketConnectOpts) {
        this.url = url;
        this.opts = opts;
    }

    addEventListener(type: 'open' | 'message' | 'close' | 'error', l: (ev: unknown) => void): void {
        this.listeners[type]?.push(l);
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (typeof data === 'string') {
            this.sentFrames.push(data);
        } else {
            const len = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
            this.sentBinaryBytes.push(len);
        }
    }

    close(code?: number, reason?: string): void {
        this.closedWith = { code, reason };
        this.readyState = 3;
        this.dispatch('close', { code, reason });
    }

    serverOpen(): void {
        this.readyState = 1;
        this.dispatch('open', {});
    }
    serverMessage(payload: object): void {
        this.dispatch('message', { data: JSON.stringify(payload) });
    }
    serverError(message: string): void {
        this.dispatch('error', { message });
    }

    private dispatch(type: string, ev: unknown): void {
        for (const l of this.listeners[type] ?? []) l(ev);
    }
}

function capturing(): {
    factory: (url: string, opts?: WebSocketConnectOpts) => WebSocketLike;
    socket: () => MockWebSocket;
} {
    let captured: MockWebSocket | null = null;
    return {
        factory: (url, opts) => {
            captured = new MockWebSocket(url, opts);
            return captured;
        },
        socket: () => {
            if (!captured) throw new Error('socket not yet created');
            return captured;
        },
    };
}

describe('connectFluxRealtime', () => {
    it('builds the v2 URL with model/encoding/sample_rate and Token auth', async () => {
        const { factory, socket } = capturing();
        const connectP = connectFluxRealtime({
            modelId: 'flux-general-en',
            apiKey: 'dg-key',
            sampleRate: 16000,
            webSocketFactory: factory,
        });
        socket().serverOpen();
        await connectP;

        const url = new URL(socket().url);
        expect(url.origin + url.pathname).toBe('wss://api.deepgram.com/v2/listen');
        expect(url.searchParams.get('model')).toBe('flux-general-en');
        expect(url.searchParams.get('encoding')).toBe('linear16');
        expect(url.searchParams.get('sample_rate')).toBe('16000');
        // Auth travels as a header (Tauri) plus a browser-compatible subprotocol.
        expect(socket().opts?.headers?.Authorization).toBe('Token dg-key');
        expect(socket().opts?.protocols).toEqual(['token', 'dg-key']);
    });

    it('resolves connect() on the socket open event', async () => {
        const { factory, socket } = capturing();
        const connectP = connectFluxRealtime({
            modelId: 'flux-general-en',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
        });
        let settled = false;
        connectP.then(() => {
            settled = true;
        });
        await new Promise((r) => setTimeout(r, 5));
        expect(settled).toBe(false);
        socket().serverOpen();
        await connectP;
        expect(settled).toBe(true);
    });

    it('sendAudio emits a raw binary PCM frame of the right byte length', async () => {
        const { factory, socket } = capturing();
        const connectP = connectFluxRealtime({
            modelId: 'flux-general-en',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
        });
        socket().serverOpen();
        const session = await connectP;

        session.sendAudio(new Int16Array([1, 2, 3, 4])); // 4 samples -> 8 bytes
        expect(socket().sentBinaryBytes).toEqual([8]);
        // No JSON/base64 wrapping on the audio path.
        expect(socket().sentFrames).toHaveLength(0);
    });

    it('finish() sends CloseStream and resolves with joined EndOfTurn transcripts', async () => {
        const { factory, socket } = capturing();
        const connectP = connectFluxRealtime({
            modelId: 'flux-general-en',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
        });
        socket().serverOpen();
        const session = await connectP;

        // A finalized turn mid-session.
        socket().serverMessage({ type: 'TurnInfo', event: 'EndOfTurn', transcript: 'hello' });

        const finishP = session.finish();
        // The control frame asks Flux to flush + close.
        expect(JSON.parse(socket().sentFrames.at(-1) ?? '{}').type).toBe('CloseStream');

        // A trailing turn arrives during the flush, then the server closes.
        socket().serverMessage({ type: 'TurnInfo', event: 'EndOfTurn', transcript: 'world' });
        socket().close(1000, 'closed');

        await expect(finishP).resolves.toBe('hello world');
    });

    it('ignores interim/eager events in the final transcript', async () => {
        const { factory, socket } = capturing();
        const connectP = connectFluxRealtime({
            modelId: 'flux-general-en',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
        });
        socket().serverOpen();
        const session = await connectP;

        socket().serverMessage({ type: 'TurnInfo', event: 'StartOfTurn' });
        socket().serverMessage({ type: 'TurnInfo', event: 'Update', transcript: 'hel' });
        socket().serverMessage({ type: 'TurnInfo', event: 'EagerEndOfTurn', transcript: 'helo' });
        socket().serverMessage({ type: 'TurnInfo', event: 'TurnResumed' });
        socket().serverMessage({ type: 'TurnInfo', event: 'EndOfTurn', transcript: 'hello there' });

        const finishP = session.finish();
        socket().close(1000, 'closed');
        await expect(finishP).resolves.toBe('hello there');
    });

    it('rejects connect() when the socket closes before opening', async () => {
        const { factory, socket } = capturing();
        const connectP = connectFluxRealtime({
            modelId: 'flux-general-en',
            apiKey: 'bad',
            sampleRate: 16000,
            webSocketFactory: factory,
        });
        socket().close(1006, 'unauthorized');
        await expect(connectP).rejects.toThrow(/closed before connect.*unauthorized/);
    });

    it('rejects connect() on an Error message before open', async () => {
        const { factory, socket } = capturing();
        const connectP = connectFluxRealtime({
            modelId: 'flux-general-en',
            apiKey: 'bad',
            sampleRate: 16000,
            webSocketFactory: factory,
        });
        socket().serverMessage({ type: 'Error', description: 'invalid model' });
        await expect(connectP).rejects.toThrow(/invalid model/);
    });

    it('abort() closes the socket without finalizing', async () => {
        const { factory, socket } = capturing();
        const connectP = connectFluxRealtime({
            modelId: 'flux-general-en',
            apiKey: 'k',
            sampleRate: 16000,
            webSocketFactory: factory,
        });
        socket().serverOpen();
        const session = await connectP;

        session.abort();
        expect(socket().closedWith?.reason).toBe('abort');
        const before = socket().sentBinaryBytes.length;
        session.sendAudio(new Int16Array([1, 2, 3]));
        expect(socket().sentBinaryBytes.length).toBe(before);
    });
});
