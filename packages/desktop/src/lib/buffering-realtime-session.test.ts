import { describe, expect, it, vi } from 'vitest';
import type { RealtimeSession } from '../providers/types';
import { bufferRealtimeSession } from './buffering-realtime-session';

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (v: T) => void;
    reject: (e: Error) => void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (v: T) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeInner(finishText = 'done'): RealtimeSession & {
    sendAudio: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
} {
    return {
        sendAudio: vi.fn(),
        finish: vi.fn(async () => finishText),
        abort: vi.fn(),
    };
}

function pcm(n: number): Int16Array {
    return new Int16Array([n]);
}

// Settle microtasks so `.then` callbacks attached to the pending promise run.
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('bufferRealtimeSession', () => {
    it('queues sendAudio while connecting and does not call inner', async () => {
        const d = deferred<RealtimeSession>();
        const inner = makeInner();
        const session = bufferRealtimeSession(d.promise);

        session.sendAudio(pcm(1));
        session.sendAudio(pcm(2));

        expect(inner.sendAudio).not.toHaveBeenCalled();

        d.resolve(inner);
        await flush();

        expect(inner.sendAudio).toHaveBeenCalledTimes(2);
        expect(inner.sendAudio.mock.calls[0]?.[0]).toEqual(pcm(1));
        expect(inner.sendAudio.mock.calls[1]?.[0]).toEqual(pcm(2));
    });

    it('flushes queued chunks in order then forwards live chunks directly', async () => {
        const d = deferred<RealtimeSession>();
        const inner = makeInner();
        const session = bufferRealtimeSession(d.promise);

        session.sendAudio(pcm(1));
        session.sendAudio(pcm(2));
        d.resolve(inner);
        await flush();

        session.sendAudio(pcm(3));
        expect(inner.sendAudio).toHaveBeenCalledTimes(3);
        expect(inner.sendAudio.mock.calls.map((c) => c[0][0])).toEqual([1, 2, 3]);
    });

    it('finish() while connecting waits for resolve then forwards', async () => {
        const d = deferred<RealtimeSession>();
        const inner = makeInner('hello');
        const session = bufferRealtimeSession(d.promise);

        session.sendAudio(pcm(1));
        const finishP = session.finish();

        // Not settled yet.
        let settled = false;
        finishP.then(() => {
            settled = true;
        });
        await flush();
        expect(settled).toBe(false);
        expect(inner.finish).not.toHaveBeenCalled();

        d.resolve(inner);
        const text = await finishP;
        expect(text).toBe('hello');
        // queue flushed before finish
        const sendOrder = inner.sendAudio.mock.invocationCallOrder[0] ?? -1;
        const finishOrder = inner.finish.mock.invocationCallOrder[0] ?? -1;
        expect(sendOrder).toBeGreaterThanOrEqual(0);
        expect(finishOrder).toBeGreaterThan(sendOrder);
    });

    it('finish() after ready passes through directly', async () => {
        const d = deferred<RealtimeSession>();
        const inner = makeInner('ok');
        const session = bufferRealtimeSession(d.promise);
        d.resolve(inner);
        await flush();

        const text = await session.finish();
        expect(text).toBe('ok');
        expect(inner.finish).toHaveBeenCalledTimes(1);
    });

    it('abort() while connecting cancels on resolve; inner sendAudio never called', async () => {
        const d = deferred<RealtimeSession>();
        const inner = makeInner();
        const session = bufferRealtimeSession(d.promise);

        session.sendAudio(pcm(1));
        session.abort();

        d.resolve(inner);
        await flush();

        expect(inner.sendAudio).not.toHaveBeenCalled();
        expect(inner.abort).toHaveBeenCalledTimes(1);
    });

    it('abort() after ready passes through directly', async () => {
        const d = deferred<RealtimeSession>();
        const inner = makeInner();
        const session = bufferRealtimeSession(d.promise);
        d.resolve(inner);
        await flush();

        session.abort();
        expect(inner.abort).toHaveBeenCalledTimes(1);
    });

    it('connect rejection: sendAudio is silent no-op; finish() rejects', async () => {
        const d = deferred<RealtimeSession>();
        const session = bufferRealtimeSession(d.promise);

        const err = new Error('boom');
        d.reject(err);
        await flush();

        expect(() => session.sendAudio(pcm(1))).not.toThrow();
        await expect(session.finish()).rejects.toBe(err);
    });

    it('finish() pending while connecting rejects with connect error', async () => {
        const d = deferred<RealtimeSession>();
        const session = bufferRealtimeSession(d.promise);

        const finishP = session.finish();
        const err = new Error('handshake refused');
        d.reject(err);

        await expect(finishP).rejects.toBe(err);
    });

    it('queue cap drops oldest and warns once', async () => {
        const d = deferred<RealtimeSession>();
        const inner = makeInner();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const session = bufferRealtimeSession(d.promise, { maxBufferedChunks: 2 });

        session.sendAudio(pcm(1));
        session.sendAudio(pcm(2));
        session.sendAudio(pcm(3));
        session.sendAudio(pcm(4));

        d.resolve(inner);
        await flush();

        expect(inner.sendAudio).toHaveBeenCalledTimes(2);
        expect(inner.sendAudio.mock.calls.map((c) => c[0][0])).toEqual([3, 4]);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});
