import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ERR_ACCESSIBILITY_REQUIRED,
    ERR_MIC_DENIED,
    ERR_WAYLAND_PASTE_UNSUPPORTED,
} from './markers';
import {
    type RecordingDeps,
    type RecordingState,
    type SetState,
    cancel,
    toggle,
} from './recording-controller';

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
        transcribe: vi.fn(async () => 'hello world'),
        getSelectedMicDeviceId: vi.fn(async () => null),
    };
}

function makeSetState(): { setState: SetState; states: RecordingState[] } {
    const states: RecordingState[] = [];
    const setState: SetState = (s) => {
        states.push(s);
    };
    return { setState, states };
}

describe('recording-controller toggle', () => {
    let deps: RecordingDeps;

    beforeEach(() => {
        deps = makeDeps();
    });

    describe('from idle', () => {
        it('starts recording when mic permission is already granted', async () => {
            const { setState, states } = makeSetState();
            await toggle({ kind: 'idle' }, deps, setState);
            expect(deps.vox.checkMicrophonePermission).toHaveBeenCalled();
            expect(deps.vox.requestMicrophonePermission).not.toHaveBeenCalled();
            expect(deps.vox.startRecording).toHaveBeenCalledWith(undefined);
            expect(states).toHaveLength(1);
            const first = states[0];
            if (!first || first.kind !== 'recording') {
                throw new Error(`expected recording state, got ${first?.kind}`);
            }
            expect(first.sessionId).toBe('session-1');
            expect(typeof first.startedAt).toBe('number');
        });

        it('forwards the selected mic device id to startRecording', async () => {
            if (!deps.getSelectedMicDeviceId) throw new Error('missing dep');
            vi.mocked(deps.getSelectedMicDeviceId).mockResolvedValueOnce('hyperx-alsa');
            const { setState, states } = makeSetState();
            await toggle({ kind: 'idle' }, deps, setState);
            expect(deps.vox.startRecording).toHaveBeenCalledWith('hyperx-alsa');
            expect(states.at(-1)?.kind).toBe('recording');
        });

        it('requests permission when undetermined and starts on grant (in order)', async () => {
            vi.mocked(deps.vox.checkMicrophonePermission).mockResolvedValueOnce('NotDetermined');
            vi.mocked(deps.vox.requestMicrophonePermission).mockResolvedValueOnce('Granted');
            const { setState, states } = makeSetState();
            await toggle({ kind: 'idle' }, deps, setState);
            expect(deps.vox.checkMicrophonePermission).toHaveBeenCalled();
            expect(deps.vox.requestMicrophonePermission).toHaveBeenCalled();
            // check happens before request, which happens before startRecording.
            const checkOrder = vi.mocked(deps.vox.checkMicrophonePermission).mock
                .invocationCallOrder[0];
            const requestOrder = vi.mocked(deps.vox.requestMicrophonePermission).mock
                .invocationCallOrder[0];
            const startOrder = vi.mocked(deps.vox.startRecording).mock.invocationCallOrder[0];
            expect(checkOrder).toBeLessThan(requestOrder ?? 0);
            expect(requestOrder).toBeLessThan(startOrder ?? 0);
            expect(states.at(-1)?.kind).toBe('recording');
        });

        it('publishes mic-denied error when NotDetermined → request returns Denied (no startRecording)', async () => {
            vi.mocked(deps.vox.checkMicrophonePermission).mockResolvedValueOnce('NotDetermined');
            vi.mocked(deps.vox.requestMicrophonePermission).mockResolvedValueOnce('Denied');
            const { setState, states } = makeSetState();
            await toggle({ kind: 'idle' }, deps, setState);
            expect(deps.vox.requestMicrophonePermission).toHaveBeenCalled();
            expect(deps.vox.startRecording).not.toHaveBeenCalled();
            const last = states.at(-1);
            expect(last?.kind).toBe('error');
            if (last?.kind === 'error') expect(last.message.startsWith(ERR_MIC_DENIED)).toBe(true);
        });

        it('publishes mic-denied error and does NOT request when already Denied', async () => {
            vi.mocked(deps.vox.checkMicrophonePermission).mockResolvedValueOnce('Denied');
            const { setState, states } = makeSetState();
            await toggle({ kind: 'idle' }, deps, setState);
            expect(deps.vox.requestMicrophonePermission).not.toHaveBeenCalled();
            expect(deps.vox.startRecording).not.toHaveBeenCalled();
            const last = states.at(-1);
            expect(last?.kind).toBe('error');
            if (last?.kind === 'error') {
                expect(last.message.startsWith(ERR_MIC_DENIED)).toBe(true);
                expect(last.message).toMatch(/System Settings/);
            }
        });

        it('publishes error when start_recording itself fails', async () => {
            vi.mocked(deps.vox.startRecording).mockRejectedValueOnce(new Error('mic in use'));
            const { setState, states } = makeSetState();
            await toggle({ kind: 'idle' }, deps, setState);
            const last = states.at(-1);
            expect(last?.kind).toBe('error');
            if (last?.kind === 'error') expect(last.message).toMatch(/mic in use/);
        });
    });

    describe('from recording', () => {
        const recState: RecordingState = {
            kind: 'recording',
            sessionId: 'session-1',
            startedAt: 0,
        };

        it('stops, publishes transcribing, then idle on the happy path', async () => {
            const { setState, states } = makeSetState();
            await toggle(recState, deps, setState);
            expect(deps.vox.stopRecording).toHaveBeenCalledWith('session-1');
            expect(deps.transcribe).toHaveBeenCalled();
            const blob = vi.mocked(deps.transcribe).mock.calls[0]?.[0];
            expect(blob).toBeInstanceOf(Blob);
            expect(blob?.type).toBe('audio/wav');
            expect(deps.vox.pasteText).toHaveBeenCalledWith('hello world');
            expect(states.map((s) => s.kind)).toEqual(['transcribing', 'idle']);
        });

        it('publishes error if stop_recording fails (no transcribing state)', async () => {
            vi.mocked(deps.vox.stopRecording).mockRejectedValueOnce(new Error('boom'));
            const { setState, states } = makeSetState();
            await toggle(recState, deps, setState);
            expect(states.map((s) => s.kind)).toEqual(['error']);
            expect(deps.transcribe).not.toHaveBeenCalled();
        });

        it('publishes transcribing then error when no model is configured', async () => {
            vi.mocked(deps.transcribe).mockRejectedValueOnce(new Error('No model selected'));
            const { setState, states } = makeSetState();
            await toggle(recState, deps, setState);
            expect(states.map((s) => s.kind)).toEqual(['transcribing', 'error']);
            const last = states.at(-1);
            if (last?.kind === 'error') expect(last.message).toMatch(/No model selected/);
            expect(deps.vox.pasteText).not.toHaveBeenCalled();
        });

        it('publishes error when paste fails', async () => {
            vi.mocked(deps.vox.pasteText).mockRejectedValueOnce(new Error('clipboard locked'));
            const { setState, states } = makeSetState();
            await toggle(recState, deps, setState);
            expect(states.map((s) => s.kind)).toEqual(['transcribing', 'error']);
        });

        it('surfaces a Wayland-specific friendly message when paste returns wayland-paste-unsupported', async () => {
            vi.mocked(deps.vox.pasteText).mockRejectedValueOnce(
                new Error(
                    `${ERR_WAYLAND_PASTE_UNSUPPORTED} Wayland blocks synthetic keystrokes from third-party apps. bluemacaw copied the text to your clipboard — press Ctrl+V to paste it.`,
                ),
            );
            const { setState, states } = makeSetState();
            await toggle(recState, deps, setState);
            expect(states.map((s) => s.kind)).toEqual(['transcribing', 'error']);
            const last = states.at(-1);
            if (last?.kind !== 'error') {
                throw new Error(`expected error state, got ${last?.kind}`);
            }
            expect(last.message).toMatch(/Wayland/);
            expect(last.message).toMatch(/Ctrl\+V/);
            // Should NOT include the macOS-specific Accessibility wording.
            expect(last.message).not.toMatch(/Accessibility/);
        });

        it('surfaces an Accessibility-specific friendly message when paste returns accessibility-required', async () => {
            vi.mocked(deps.vox.pasteText).mockRejectedValueOnce(
                new Error(
                    `${ERR_ACCESSIBILITY_REQUIRED} synthetic paste needs Accessibility. Grant bluemacaw in System Settings → Privacy & Security → Accessibility, then try again.`,
                ),
            );
            const { setState, states } = makeSetState();
            await toggle(recState, deps, setState);
            const last = states.at(-1);
            if (last?.kind !== 'error') {
                throw new Error(`expected error state, got ${last?.kind}`);
            }
            expect(last.message).toMatch(/Accessibility/);
            expect(last.message).toMatch(/Cmd\+V/);
            // Should NOT include the Wayland wording.
            expect(last.message).not.toMatch(/Wayland/);
        });
    });

    describe('from transcribing', () => {
        it('ignores the press (no state changes published)', async () => {
            const { setState, states } = makeSetState();
            await toggle({ kind: 'transcribing' }, deps, setState);
            expect(states).toEqual([]);
            expect(deps.vox.startRecording).not.toHaveBeenCalled();
            expect(deps.vox.stopRecording).not.toHaveBeenCalled();
        });
    });

    describe('from error', () => {
        it('treats next press as a fresh idle press', async () => {
            const { setState, states } = makeSetState();
            await toggle({ kind: 'error', message: 'whatever' }, deps, setState);
            expect(deps.vox.startRecording).toHaveBeenCalled();
            expect(states.at(-1)?.kind).toBe('recording');
        });
    });
});

describe('recording-controller cancel', () => {
    let deps: RecordingDeps;

    beforeEach(() => {
        deps = makeDeps();
    });

    const recState: RecordingState = {
        kind: 'recording',
        sessionId: 'session-1',
        startedAt: 0,
    };

    it('cancels from recording: calls cancelRecording, returns to idle, no transcribe/paste', async () => {
        const { setState, states } = makeSetState();
        await cancel(recState, deps, setState);
        expect(deps.vox.cancelRecording).toHaveBeenCalledWith('session-1');
        expect(deps.transcribe).not.toHaveBeenCalled();
        expect(deps.vox.pasteText).not.toHaveBeenCalled();
        expect(deps.vox.stopRecording).not.toHaveBeenCalled();
        expect(states.map((s) => s.kind)).toEqual(['idle']);
    });

    it('still returns to idle when the backend cancel call fails', async () => {
        vi.mocked(deps.vox.cancelRecording).mockRejectedValueOnce(new Error('session not found'));
        const { setState, states } = makeSetState();
        await cancel(recState, deps, setState);
        expect(states.map((s) => s.kind)).toEqual(['idle']);
        expect(deps.transcribe).not.toHaveBeenCalled();
    });

    it('is a no-op from idle', async () => {
        const { setState, states } = makeSetState();
        await cancel({ kind: 'idle' }, deps, setState);
        expect(states).toEqual([]);
        expect(deps.vox.cancelRecording).not.toHaveBeenCalled();
    });

    it('is a no-op from transcribing (already committed)', async () => {
        const { setState, states } = makeSetState();
        await cancel({ kind: 'transcribing' }, deps, setState);
        expect(states).toEqual([]);
        expect(deps.vox.cancelRecording).not.toHaveBeenCalled();
    });

    it('is a no-op from error', async () => {
        const { setState, states } = makeSetState();
        await cancel({ kind: 'error', message: 'whatever' }, deps, setState);
        expect(states).toEqual([]);
        expect(deps.vox.cancelRecording).not.toHaveBeenCalled();
    });
});

describe('recording-controller realtime path', () => {
    // The realtime branch is opt-in via `resolveActiveMode`: when it
    // returns 'realtime', startFromIdle calls `startRealtimeCapture`
    // instead of `vox.startRecording`, and stopAndTranscribe drives the
    // provider session's `finish()` instead of feeding a Blob through the
    // batch transcribe path. These tests pin both shapes.

    function makeSession() {
        return {
            sendAudio: vi.fn(),
            finish: vi.fn(async () => 'hello realtime'),
            abort: vi.fn(),
        };
    }

    function makeRealtimeDeps(): RecordingDeps & {
        session: ReturnType<typeof makeSession>;
        unlisten: ReturnType<typeof vi.fn>;
    } {
        const session = makeSession();
        const unlisten = vi.fn();
        const base = makeDeps();
        return {
            ...base,
            resolveActiveMode: vi.fn(async () => 'realtime' as const),
            startRealtimeCapture: vi.fn(async () => ({
                rustSessionId: 'rt-session-1',
                session,
                unlisten,
            })),
            session,
            unlisten,
        };
    }

    it('startFromIdle uses startRealtimeCapture and stores it on the state', async () => {
        const deps = makeRealtimeDeps();
        const { setState, states } = makeSetState();
        await toggle({ kind: 'idle' }, deps, setState);
        expect(deps.startRealtimeCapture).toHaveBeenCalledWith(undefined);
        expect(deps.vox.startRecording).not.toHaveBeenCalled();
        const last = states.at(-1);
        if (last?.kind !== 'recording' || !last.realtime) {
            throw new Error(`expected recording+realtime state, got ${last?.kind}`);
        }
        expect(last.sessionId).toBe('rt-session-1');
        expect(last.realtime.session).toBe(deps.session);
    });

    it('forwards the selected mic device id to startRealtimeCapture', async () => {
        const deps = makeRealtimeDeps();
        if (!deps.getSelectedMicDeviceId) throw new Error('missing dep');
        vi.mocked(deps.getSelectedMicDeviceId).mockResolvedValueOnce('hyperx-alsa');
        const { setState, states } = makeSetState();
        await toggle({ kind: 'idle' }, deps, setState);
        expect(deps.startRealtimeCapture).toHaveBeenCalledWith('hyperx-alsa');
        expect(deps.vox.startRecording).not.toHaveBeenCalled();
        expect(states.at(-1)?.kind).toBe('recording');
    });

    it('stopAndTranscribe awaits session.finish() and pastes the result', async () => {
        const deps = makeRealtimeDeps();
        const { setState, states } = makeSetState();
        const recState: RecordingState = {
            kind: 'recording',
            sessionId: 'rt-session-1',
            startedAt: 0,
            realtime: {
                rustSessionId: 'rt-session-1',
                session: deps.session,
                unlisten: deps.unlisten,
            },
        };
        await toggle(recState, deps, setState);
        expect(deps.vox.stopRecording).toHaveBeenCalledWith('rt-session-1');
        expect(deps.unlisten).toHaveBeenCalled();
        expect(deps.session.finish).toHaveBeenCalled();
        // Batch transcribe path must not be touched on realtime.
        expect(deps.transcribe).not.toHaveBeenCalled();
        expect(deps.vox.pasteText).toHaveBeenCalledWith('hello realtime');
        expect(states.map((s) => s.kind)).toEqual(['transcribing', 'idle']);
    });

    it('cancel calls session.abort and unlisten before tearing down cpal', async () => {
        const deps = makeRealtimeDeps();
        const { setState, states } = makeSetState();
        const recState: RecordingState = {
            kind: 'recording',
            sessionId: 'rt-session-1',
            startedAt: 0,
            realtime: {
                rustSessionId: 'rt-session-1',
                session: deps.session,
                unlisten: deps.unlisten,
            },
        };
        await cancel(recState, deps, setState);
        expect(deps.unlisten).toHaveBeenCalled();
        expect(deps.session.abort).toHaveBeenCalled();
        expect(deps.vox.cancelRecording).toHaveBeenCalledWith('rt-session-1');
        // session.finish() must NOT run on cancel — that would commit + pay
        // for a transcript the user explicitly threw away.
        expect(deps.session.finish).not.toHaveBeenCalled();
        expect(states.map((s) => s.kind)).toEqual(['idle']);
    });

    it('falls back to batch when startRealtimeCapture rejects', async () => {
        // Realistic failure: WS handshake error (auth, network). startFromIdle
        // surfaces the error rather than silently downgrading — the user picked
        // a realtime model and a quiet fallback would hide a real failure.
        const deps = makeRealtimeDeps();
        // `startRealtimeCapture` is always present in makeRealtimeDeps; the
        // non-null narrowing keeps biome happy without a `!` assertion.
        const startRt = deps.startRealtimeCapture;
        if (!startRt) throw new Error('startRealtimeCapture missing from test deps');
        vi.mocked(startRt).mockRejectedValueOnce(
            new Error('elevenlabs scribe realtime: auth_error'),
        );
        const { setState, states } = makeSetState();
        await toggle({ kind: 'idle' }, deps, setState);
        const last = states.at(-1);
        expect(last?.kind).toBe('error');
        if (last?.kind === 'error') expect(last.message).toMatch(/auth_error/);
        expect(deps.vox.startRecording).not.toHaveBeenCalled();
    });
});
