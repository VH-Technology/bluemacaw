/**
 * Generic buffering wrapper for any [`RealtimeSession`]. Lets the recording
 * controller forward audio chunks before the underlying provider session
 * has finished its handshake — chunks queue in memory and flush in arrival
 * order once the inner session is ready.
 *
 * The whole point is provider-agnosticism: the orchestrator stops awaiting
 * `connect()` before grabbing the mic, and every existing/future realtime
 * adapter slots in unchanged. The wrapper itself never speaks the wire
 * protocol — it only re-plays whatever the caller would have done had the
 * inner session been ready synchronously.
 *
 * State machine:
 *   connecting → ready  (on pending.resolve)
 *   connecting → failed (on pending.reject)
 *
 * `finish()` / `abort()` issued during `connecting` are deferred until
 * resolution: on `ready` they run after the queue flush; on `failed` a
 * pending `finish()` rejects with the connect error.
 */

import type { RealtimeSession } from '../providers/types';

export interface BufferRealtimeSessionOptions {
    /**
     * Maximum number of PCM chunks to hold while waiting for the inner
     * session. At ~20 ms per chunk this defaults to ~60 s of audio, which
     * is plenty for any realistic handshake — past that the connect is
     * effectively broken and unbounded memory growth would be worse than
     * dropping the oldest audio.
     */
    maxBufferedChunks?: number;
}

const DEFAULT_MAX_BUFFERED_CHUNKS = 3000;

export function bufferRealtimeSession(
    pending: Promise<RealtimeSession>,
    opts: BufferRealtimeSessionOptions = {},
): RealtimeSession {
    const maxBuffered = opts.maxBufferedChunks ?? DEFAULT_MAX_BUFFERED_CHUNKS;

    type Status =
        | { kind: 'connecting' }
        | { kind: 'ready'; inner: RealtimeSession }
        | { kind: 'failed'; error: Error };
    let status: Status = { kind: 'connecting' };

    const queue: Int16Array[] = [];
    let dropWarned = false;
    let aborted = false;

    // Pending finish() from the connecting state. Resolved/rejected when
    // the inner session settles (or the connect fails).
    let pendingFinish: {
        resolve: (text: string) => void;
        reject: (err: Error) => void;
    } | null = null;

    pending.then(
        (inner) => {
            if (aborted) {
                // Caller already gave up — don't replay queued audio.
                status = { kind: 'ready', inner };
                queue.length = 0;
                try {
                    inner.abort();
                } catch (e) {
                    console.warn('buffering session: inner abort failed', e);
                }
                if (pendingFinish) {
                    // abort + finish raced; finish loses. Resolve with
                    // empty text so the recording controller's catch is
                    // not invoked for what was effectively a cancel.
                    pendingFinish.resolve('');
                    pendingFinish = null;
                }
                return;
            }
            status = { kind: 'ready', inner };
            for (const chunk of queue) inner.sendAudio(chunk);
            queue.length = 0;
            if (pendingFinish) {
                const { resolve, reject } = pendingFinish;
                pendingFinish = null;
                inner.finish().then(resolve, reject);
            }
        },
        (err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err));
            status = { kind: 'failed', error };
            queue.length = 0;
            if (pendingFinish) {
                pendingFinish.reject(error);
                pendingFinish = null;
            }
        },
    );

    return {
        sendAudio(pcm) {
            switch (status.kind) {
                case 'ready':
                    status.inner.sendAudio(pcm);
                    return;
                case 'failed':
                    return;
                case 'connecting':
                    if (aborted) return;
                    if (queue.length >= maxBuffered) {
                        queue.shift();
                        if (!dropWarned) {
                            dropWarned = true;
                            console.warn(
                                `buffering session: queue cap ${maxBuffered} reached, dropping oldest chunks`,
                            );
                        }
                    }
                    queue.push(pcm);
                    return;
            }
        },
        finish() {
            switch (status.kind) {
                case 'ready':
                    return status.inner.finish();
                case 'failed':
                    return Promise.reject(status.error);
                case 'connecting':
                    return new Promise<string>((resolve, reject) => {
                        pendingFinish = { resolve, reject };
                    });
            }
        },
        abort() {
            switch (status.kind) {
                case 'ready':
                    status.inner.abort();
                    return;
                case 'failed':
                    return;
                case 'connecting':
                    aborted = true;
                    queue.length = 0;
                    return;
            }
        },
    };
}
