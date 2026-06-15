import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listenMock, fireEvent } = vi.hoisted(() => {
    type Handler = () => void;
    const handlers = new Map<string, Handler>();
    return {
        listenMock: vi.fn(async (name: string, h: Handler) => {
            handlers.set(name, h);
            return () => {
                handlers.delete(name);
            };
        }),
        // Default fires the toggle handler so existing tests that just call
        // `fireEvent()` continue to drive the toggle path.
        fireEvent: (eventName?: string) => {
            const name = eventName ?? 'bluemacaw://shortcut-toggle';
            handlers.get(name)?.();
        },
    };
});

vi.mock('@tauri-apps/api/event', () => ({
    listen: listenMock,
}));

vi.mock('@/lib/db', () => ({
    getCancelHotkeyCombo: vi.fn(async () => 'Escape'),
}));

vi.mock('@/lib/invoke', () => ({
    vox: {
        registerCancelHotkey: vi.fn(async () => 'Escape'),
        unregisterCancelHotkey: vi.fn(async () => undefined),
    },
}));

import { getCancelHotkeyCombo } from '@/lib/db';
import { vox } from '@/lib/invoke';
import { EVT_SHORTCUT_CANCEL } from '@/lib/markers';
import type { RecordingDeps, RecordingState } from '@/lib/recording-controller';
import { SHORTCUT_EVENT, useHotkeyRecording } from './useHotkeyRecording';

function makeDeps(): RecordingDeps {
    return {
        vox: {
            startRecording: vi.fn(async () => 'session-1'),
            stopRecording: vi.fn(async () => [82, 73, 70, 70]),
            cancelRecording: vi.fn(async () => undefined),
            pasteText: vi.fn(async () => undefined),
            checkMicrophonePermission: vi.fn(async () => 'Granted' as const),
            requestMicrophonePermission: vi.fn(async () => 'Granted' as const),
            duckSystemVolume: vi.fn(async () => undefined),
            restoreSystemVolume: vi.fn(async () => undefined),
        },
        transcribe: vi.fn(async () => 'hi'),
        // Provide DB-backed deps explicitly: mocking `@/lib/db` at the
        // module level (needed for the cancel-hotkey lifecycle) wipes out
        // the default fallbacks recording-controller would otherwise reach
        // for. Passing stubs here keeps the controller path test-isolated.
        saveTranscription: vi.fn(async () => undefined),
        resolveActiveConfig: vi.fn(async () => null),
        getSelectedMicDeviceId: vi.fn(async () => null),
    };
}

function makePublish() {
    return vi.fn<(state: RecordingState) => Promise<void>>(async () => undefined);
}

beforeEach(() => {
    listenMock.mockClear();
    vi.mocked(getCancelHotkeyCombo).mockClear();
    vi.mocked(getCancelHotkeyCombo).mockResolvedValue('Escape');
    vi.mocked(vox.registerCancelHotkey).mockClear();
    vi.mocked(vox.registerCancelHotkey).mockResolvedValue('Escape');
    vi.mocked(vox.unregisterCancelHotkey).mockClear();
    vi.mocked(vox.unregisterCancelHotkey).mockResolvedValue(undefined);
});

describe('useHotkeyRecording', () => {
    it('starts in idle and subscribes to the shortcut event', () => {
        const { result } = renderHook(() =>
            useHotkeyRecording({ deps: makeDeps(), publish: makePublish() }),
        );
        expect(result.current.state).toEqual({ kind: 'idle' });
        expect(listenMock).toHaveBeenCalledWith(SHORTCUT_EVENT, expect.any(Function));
    });

    it('toggles idle → recording on first event', async () => {
        const deps = makeDeps();
        const { result } = renderHook(() => useHotkeyRecording({ deps, publish: makePublish() }));
        await act(async () => {
            fireEvent();
        });
        await waitFor(() => {
            expect(result.current.state.kind).toBe('recording');
        });
        expect(deps.vox.startRecording).toHaveBeenCalled();
    });

    it('cycles recording → transcribing → idle on second event', async () => {
        const deps = makeDeps();
        const { result } = renderHook(() => useHotkeyRecording({ deps, publish: makePublish() }));
        await act(async () => {
            fireEvent();
        });
        await waitFor(() => expect(result.current.state.kind).toBe('recording'));

        await act(async () => {
            fireEvent();
        });
        await waitFor(() => expect(result.current.state.kind).toBe('idle'));
        expect(deps.vox.pasteText).toHaveBeenCalledWith('hi');
    });

    it('surfaces errors as error state', async () => {
        const deps = makeDeps();
        vi.mocked(deps.vox.checkMicrophonePermission).mockResolvedValueOnce('Denied');
        const { result } = renderHook(() => useHotkeyRecording({ deps, publish: makePublish() }));
        await act(async () => {
            fireEvent();
        });
        await waitFor(() => expect(result.current.state.kind).toBe('error'));
    });

    it('publishes every state transition to the bridge', async () => {
        const deps = makeDeps();
        const publish = makePublish();
        renderHook(() => useHotkeyRecording({ deps, publish }));
        await act(async () => {
            fireEvent();
        });
        await waitFor(() => {
            expect(publish.mock.calls.map((c) => c[0].kind)).toContain('recording');
        });
        await act(async () => {
            fireEvent();
        });
        await waitFor(() => {
            const kinds = publish.mock.calls.map((c) => c[0].kind);
            expect(kinds).toContain('transcribing');
            expect(kinds).toContain('idle');
        });
    });

    it('subscribes to the cancel event in addition to the toggle event', () => {
        renderHook(() => useHotkeyRecording({ deps: makeDeps(), publish: makePublish() }));
        const subscribedEvents = listenMock.mock.calls.map((c) => c[0]);
        expect(subscribedEvents).toContain(SHORTCUT_EVENT);
        expect(subscribedEvents).toContain(EVT_SHORTCUT_CANCEL);
    });

    it('cancel event aborts an in-progress recording and returns to idle', async () => {
        const deps = makeDeps();
        const { result } = renderHook(() => useHotkeyRecording({ deps, publish: makePublish() }));
        await act(async () => {
            fireEvent();
        });
        await waitFor(() => expect(result.current.state.kind).toBe('recording'));

        await act(async () => {
            fireEvent(EVT_SHORTCUT_CANCEL);
        });
        await waitFor(() => expect(result.current.state.kind).toBe('idle'));
        expect(deps.vox.cancelRecording).toHaveBeenCalledWith('session-1');
        expect(deps.transcribe).not.toHaveBeenCalled();
        expect(deps.vox.pasteText).not.toHaveBeenCalled();
        expect(deps.vox.stopRecording).not.toHaveBeenCalled();
    });

    it('cancel event is a no-op when idle', async () => {
        const deps = makeDeps();
        const { result } = renderHook(() => useHotkeyRecording({ deps, publish: makePublish() }));
        await act(async () => {
            fireEvent(EVT_SHORTCUT_CANCEL);
        });
        expect(result.current.state.kind).toBe('idle');
        expect(deps.vox.cancelRecording).not.toHaveBeenCalled();
    });

    it('registers the cancel hotkey on recording start and unregisters when the recording ends', async () => {
        const deps = makeDeps();
        const { result } = renderHook(() => useHotkeyRecording({ deps, publish: makePublish() }));

        // idle → recording fires registerCancelHotkey with the stored combo
        await act(async () => {
            fireEvent();
        });
        await waitFor(() => expect(result.current.state.kind).toBe('recording'));
        await waitFor(() => expect(vox.registerCancelHotkey).toHaveBeenCalledWith('Escape'));
        expect(vox.unregisterCancelHotkey).not.toHaveBeenCalled();

        // recording → transcribing → idle unregisters the cancel hotkey
        await act(async () => {
            fireEvent();
        });
        await waitFor(() => expect(result.current.state.kind).toBe('idle'));
        await waitFor(() => expect(vox.unregisterCancelHotkey).toHaveBeenCalled());
    });

    it('unregisters the cancel hotkey when the user cancels mid-recording', async () => {
        const deps = makeDeps();
        const { result } = renderHook(() => useHotkeyRecording({ deps, publish: makePublish() }));
        await act(async () => {
            fireEvent();
        });
        await waitFor(() => expect(result.current.state.kind).toBe('recording'));
        await waitFor(() => expect(vox.registerCancelHotkey).toHaveBeenCalled());

        await act(async () => {
            fireEvent(EVT_SHORTCUT_CANCEL);
        });
        await waitFor(() => expect(result.current.state.kind).toBe('idle'));
        await waitFor(() => expect(vox.unregisterCancelHotkey).toHaveBeenCalled());
    });

    it('does not register the cancel hotkey while idle', async () => {
        renderHook(() => useHotkeyRecording({ deps: makeDeps(), publish: makePublish() }));
        // Give any synchronous effects a chance to run.
        await waitFor(() => {
            expect(vox.registerCancelHotkey).not.toHaveBeenCalled();
        });
    });

    it('ignores events fired during transcribing (no double-stop)', async () => {
        // Make transcribe slow so we can fire while in transcribing.
        const deps = makeDeps();
        let resolveTranscribe!: (s: string) => void;
        vi.mocked(deps.transcribe).mockImplementationOnce(
            () =>
                new Promise<string>((res) => {
                    resolveTranscribe = res;
                }),
        );
        const { result } = renderHook(() => useHotkeyRecording({ deps, publish: makePublish() }));
        await act(async () => {
            fireEvent();
        });
        await waitFor(() => expect(result.current.state.kind).toBe('recording'));
        await act(async () => {
            fireEvent();
        });
        await waitFor(() => expect(result.current.state.kind).toBe('transcribing'));

        const stopCallsBefore = vi.mocked(deps.vox.stopRecording).mock.calls.length;
        await act(async () => {
            fireEvent();
        });
        // No additional stop call.
        expect(vi.mocked(deps.vox.stopRecording).mock.calls.length).toBe(stopCallsBefore);

        await act(async () => {
            resolveTranscribe('done');
        });
        await waitFor(() => expect(result.current.state.kind).toBe('idle'));
    });
});
