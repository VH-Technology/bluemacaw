import type { DownloadEvent } from '@tauri-apps/plugin-updater';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type UpdaterDeps, useUpdater } from './useUpdater';

type DownloadHandler = (event: DownloadEvent) => void;

function makeUpdate(version: string, run?: (handler: DownloadHandler) => Promise<void>) {
    return {
        version,
        downloadAndInstall: vi.fn(async (handler?: DownloadHandler) => {
            if (run && handler) await run(handler);
        }),
        // The other Update fields aren't read by the hook; cast keeps the test
        // honest about that without dragging in the full Tauri type surface.
    } as unknown as Awaited<ReturnType<UpdaterDeps['check']>>;
}

function makeDeps(overrides: Partial<UpdaterDeps> = {}): UpdaterDeps {
    return {
        check: vi.fn(async () => null) as unknown as UpdaterDeps['check'],
        restartApp: vi.fn(async () => {}),
        // No-op sleep so the backoff retry loop runs instantly in tests.
        sleep: vi.fn(async () => {}),
        ...overrides,
    };
}

// Fast retry config so the loop is short and the backoff delays are easy to
// assert without dragging in the production 1s/2s/4s/8s schedule.
const FAST_RETRY = { attempts: 4, baseDelayMs: 10, maxDelayMs: 80 };

describe('useUpdater', () => {
    it('starts idle', () => {
        const { result } = renderHook(() => useUpdater({ deps: makeDeps() }));
        expect(result.current.status).toEqual({ kind: 'idle' });
    });

    it('reports up-to-date when check() resolves to null', async () => {
        const deps = makeDeps();
        const { result } = renderHook(() => useUpdater({ deps }));
        await act(async () => {
            await result.current.checkForUpdates();
        });
        expect(result.current.status).toEqual({ kind: 'up-to-date' });
    });

    it('reports available with version when check() returns an Update', async () => {
        const deps = makeDeps({
            check: vi.fn(async () => makeUpdate('0.2.0')) as unknown as UpdaterDeps['check'],
        });
        const { result } = renderHook(() => useUpdater({ deps }));
        await act(async () => {
            await result.current.checkForUpdates();
        });
        expect(result.current.status).toEqual({ kind: 'available', version: '0.2.0' });
    });

    it('reports error after exhausting all retries when check() keeps throwing', async () => {
        const check = vi.fn(async () => {
            throw new Error('network down');
        }) as unknown as UpdaterDeps['check'];
        const deps = makeDeps({ check });
        const { result } = renderHook(() => useUpdater({ deps, retry: FAST_RETRY }));
        await act(async () => {
            await result.current.checkForUpdates();
        });
        expect(result.current.status).toEqual({ kind: 'error', message: 'network down' });
        // 4 attempts total, with a backoff sleep before each of the 3 retries.
        expect(check).toHaveBeenCalledTimes(4);
        expect(deps.sleep).toHaveBeenCalledTimes(3);
        expect((deps.sleep as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
            10, 20, 40,
        ]);
    });

    it('caps the backoff delay at maxDelayMs', async () => {
        const check = vi.fn(async () => {
            throw new Error('still down');
        }) as unknown as UpdaterDeps['check'];
        const deps = makeDeps({ check });
        const { result } = renderHook(() =>
            useUpdater({ deps, retry: { attempts: 5, baseDelayMs: 1000, maxDelayMs: 4000 } }),
        );
        await act(async () => {
            await result.current.checkForUpdates();
        });
        // 1000, 2000, 4000, then capped at 4000 (not 8000).
        expect((deps.sleep as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([
            1000, 2000, 4000, 4000,
        ]);
    });

    it('recovers without erroring when a later retry succeeds', async () => {
        let calls = 0;
        const check = vi.fn(async () => {
            calls += 1;
            if (calls < 3) throw new Error('not yet');
            return makeUpdate('0.2.0');
        }) as unknown as UpdaterDeps['check'];
        const deps = makeDeps({ check });
        const { result } = renderHook(() => useUpdater({ deps, retry: FAST_RETRY }));
        await act(async () => {
            await result.current.checkForUpdates();
        });
        expect(result.current.status).toEqual({ kind: 'available', version: '0.2.0' });
        expect(check).toHaveBeenCalledTimes(3);
        expect(deps.sleep).toHaveBeenCalledTimes(2);
    });

    it('never surfaces error mid-loop — only after the final retry fails', async () => {
        const seenDuringSleep: string[] = [];
        const check = vi.fn(async () => {
            throw new Error('down');
        }) as unknown as UpdaterDeps['check'];
        const deps = makeDeps({ check });
        // Capture the status observed at each backoff sleep — it must never be
        // 'error' until the very last attempt has failed (the user should not
        // see a flash of failure while retries are still pending).
        const { result } = renderHook(() =>
            useUpdater({
                deps: {
                    ...deps,
                    sleep: vi.fn(async () => {
                        seenDuringSleep.push(result.current.status.kind);
                    }),
                },
                retry: FAST_RETRY,
            }),
        );
        await act(async () => {
            await result.current.checkForUpdates();
        });
        expect(seenDuringSleep).toHaveLength(3);
        expect(seenDuringSleep.every((kind) => kind !== 'error')).toBe(true);
        expect(result.current.status.kind).toBe('error');
    });

    it('does nothing on install when no update has been resolved', async () => {
        const deps = makeDeps();
        const { result } = renderHook(() => useUpdater({ deps }));
        await act(async () => {
            await result.current.installAndRestart();
        });
        expect(result.current.status).toEqual({ kind: 'idle' });
        expect(deps.restartApp).not.toHaveBeenCalled();
    });

    it('progresses through downloading → installing → restart', async () => {
        const update = makeUpdate('0.2.0', async (handler: DownloadHandler) => {
            handler({ event: 'Started', data: { contentLength: 1000 } });
            handler({ event: 'Progress', data: { chunkLength: 500 } });
            handler({ event: 'Progress', data: { chunkLength: 500 } });
            handler({ event: 'Finished' });
        });
        const deps = makeDeps({
            check: vi.fn(async () => update) as unknown as UpdaterDeps['check'],
        });
        const { result } = renderHook(() => useUpdater({ deps }));
        await act(async () => {
            await result.current.checkForUpdates();
        });
        await act(async () => {
            await result.current.installAndRestart();
        });
        await waitFor(() => {
            expect(deps.restartApp).toHaveBeenCalledTimes(1);
        });
        // biome-ignore lint/style/noNonNullAssertion: makeUpdate always returns non-null
        expect(update!.downloadAndInstall).toHaveBeenCalledTimes(1);
    });

    it('surfaces an error when downloadAndInstall throws', async () => {
        const update = {
            version: '0.2.0',
            downloadAndInstall: vi.fn(async () => {
                throw new Error('signature mismatch');
            }),
        } as unknown as Awaited<ReturnType<UpdaterDeps['check']>>;
        const deps = makeDeps({
            check: vi.fn(async () => update) as unknown as UpdaterDeps['check'],
        });
        const { result } = renderHook(() => useUpdater({ deps }));
        await act(async () => {
            await result.current.checkForUpdates();
        });
        await act(async () => {
            await result.current.installAndRestart();
        });
        expect(result.current.status).toEqual({
            kind: 'error',
            message: 'signature mismatch',
        });
        expect(deps.restartApp).not.toHaveBeenCalled();
    });
});
