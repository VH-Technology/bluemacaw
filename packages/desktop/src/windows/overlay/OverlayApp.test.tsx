import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    listenMock,
    fireEvent,
    currentMonitorMock,
    setPositionMock,
    onMovedMock,
    fireMoved,
    getOverlayPositionMock,
    setOverlayPositionMock,
    exitOverlayPositionSetupMock,
    getRecordingLevelMock,
} = vi.hoisted(() => {
    type Handler = (event: { payload: unknown }) => void;
    const handlers = new Map<string, Handler>();
    let movedHandler: ((e: { payload: { x: number; y: number } }) => void) | null = null;
    return {
        listenMock: vi.fn(async (name: string, h: Handler) => {
            handlers.set(name, h);
            return () => {
                handlers.delete(name);
            };
        }),
        fireEvent: (name: string, payload: unknown) => handlers.get(name)?.({ payload }),
        currentMonitorMock: vi.fn<
            () => Promise<{ size: { width: number; height: number } } | null>
        >(async () => ({ size: { width: 1920, height: 1080 } })),
        setPositionMock: vi.fn<(p: { x: number; y: number }) => Promise<void>>(
            async () => undefined,
        ),
        onMovedMock: vi.fn(async (h: (e: { payload: { x: number; y: number } }) => void) => {
            movedHandler = h;
            return () => {
                movedHandler = null;
            };
        }),
        fireMoved: (x: number, y: number) => movedHandler?.({ payload: { x, y } }),
        getOverlayPositionMock: vi.fn<() => Promise<{ x: number; y: number } | null>>(
            async () => null,
        ),
        setOverlayPositionMock: vi.fn<(p: { x: number; y: number }) => Promise<void>>(
            async () => undefined,
        ),
        exitOverlayPositionSetupMock: vi.fn<(opts?: { hide: boolean }) => Promise<void>>(
            async () => undefined,
        ),
        getRecordingLevelMock: vi.fn<(sessionId: string) => Promise<number>>(async () => 0),
    };
});

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('@tauri-apps/api/window', () => ({
    listen: listenMock,
    currentMonitor: currentMonitorMock,
    getCurrentWindow: () => ({
        setPosition: setPositionMock,
        onMoved: onMovedMock,
    }),
    PhysicalPosition: class {
        constructor(
            public x: number,
            public y: number,
        ) {}
    },
}));
vi.mock('@/lib/db', () => ({
    getOverlayPosition: getOverlayPositionMock,
    setOverlayPosition: setOverlayPositionMock,
}));
vi.mock('@/lib/overlay-bridge', () => ({
    RECORDING_STATE_EVENT: 'bluemacaw://recording-state',
    OVERLAY_POSITION_SETUP_ON_EVENT: 'bluemacaw://overlay-position-setup-on',
    OVERLAY_POSITION_SETUP_OFF_EVENT: 'bluemacaw://overlay-position-setup-off',
    OVERLAY_RESET_POSITION_EVENT: 'bluemacaw://overlay-reset-position',
    exitOverlayPositionSetup: exitOverlayPositionSetupMock,
}));
vi.mock('@/lib/invoke', () => ({
    vox: {
        getRecordingLevel: getRecordingLevelMock,
        getPlatformInfo: vi.fn(async () => ({ os: 'macos', isWayland: false })),
    },
}));

import { OverlayApp } from './OverlayApp';

const RECORDING_EVENT = 'bluemacaw://recording-state';
const SETUP_ON_EVENT = 'bluemacaw://overlay-position-setup-on';
const SETUP_OFF_EVENT = 'bluemacaw://overlay-position-setup-off';
const RESET_EVENT = 'bluemacaw://overlay-reset-position';

beforeEach(() => {
    listenMock.mockClear();
    currentMonitorMock.mockReset().mockResolvedValue({ size: { width: 1920, height: 1080 } });
    setPositionMock.mockClear();
    onMovedMock.mockClear();
    getOverlayPositionMock.mockReset().mockResolvedValue(null);
    setOverlayPositionMock.mockReset().mockResolvedValue(undefined);
    exitOverlayPositionSetupMock.mockReset().mockResolvedValue(undefined);
    getRecordingLevelMock.mockReset().mockResolvedValue(0);
    vi.useRealTimers();
});

describe('<OverlayApp />', () => {
    it('renders nothing initially (idle → hidden)', () => {
        const { container } = render(<OverlayApp />);
        expect(container).toBeEmptyDOMElement();
    });

    it('positions the window at bottom-center on mount when no saved position', async () => {
        render(<OverlayApp />);
        await waitFor(() => {
            expect(setPositionMock).toHaveBeenCalledTimes(1);
        });
        const arg = setPositionMock.mock.calls[0]?.[0];
        expect(arg?.x).toBe(820);
        expect(arg?.y).toBe(936);
    });

    it('restores the saved position on mount', async () => {
        getOverlayPositionMock.mockResolvedValueOnce({ x: 50, y: 60 });
        render(<OverlayApp />);
        await waitFor(() => {
            expect(setPositionMock).toHaveBeenCalledTimes(1);
        });
        const arg = setPositionMock.mock.calls[0]?.[0];
        expect(arg?.x).toBe(50);
        expect(arg?.y).toBe(60);
        expect(currentMonitorMock).not.toHaveBeenCalled();
    });

    it('renders the recording pill on a recording event', async () => {
        render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(RECORDING_EVENT, expect.any(Function)),
        );
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'recording', sessionId: 'session-1' });
        });
        const pill = await screen.findByTestId('overlay-pill');
        expect(pill).toHaveTextContent(/recording/i);
    });

    it('renders the transcribing pill on a transcribing event', async () => {
        render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(RECORDING_EVENT, expect.any(Function)),
        );
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'transcribing' });
        });
        const pill = await screen.findByTestId('overlay-pill');
        expect(pill).toHaveTextContent(/transcrib/i);
    });

    it('hides on idle event', async () => {
        const { container } = render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(RECORDING_EVENT, expect.any(Function)),
        );
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'recording', sessionId: 'session-1' });
        });
        await screen.findByTestId('overlay-pill');
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'idle' });
        });
        await waitFor(() => {
            expect(container.querySelector('[data-testid="overlay-pill"]')).toBeNull();
        });
    });

    it('hides on error event', async () => {
        const { container } = render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(RECORDING_EVENT, expect.any(Function)),
        );
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'recording', sessionId: 'session-1' });
        });
        await screen.findByTestId('overlay-pill');
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'error', message: 'boom' });
        });
        await waitFor(() => {
            expect(container.querySelector('[data-testid="overlay-pill"]')).toBeNull();
        });
    });

    it('skips positioning if currentMonitor returns null and no saved position', async () => {
        currentMonitorMock.mockResolvedValueOnce(null);
        render(<OverlayApp />);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(setPositionMock).not.toHaveBeenCalled();
    });

    it('persists the position on move (after debounce)', async () => {
        render(<OverlayApp />);
        await waitFor(() => expect(onMovedMock).toHaveBeenCalled());
        vi.useFakeTimers();
        act(() => {
            fireMoved(200, 300);
        });
        expect(setOverlayPositionMock).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(401);
        });
        expect(setOverlayPositionMock).toHaveBeenCalledTimes(1);
        expect(setOverlayPositionMock).toHaveBeenCalledWith({ x: 200, y: 300 });
    });

    it('debounces multiple rapid move events into one save with the last position', async () => {
        render(<OverlayApp />);
        await waitFor(() => expect(onMovedMock).toHaveBeenCalled());
        vi.useFakeTimers();
        act(() => {
            fireMoved(100, 100);
            fireMoved(150, 150);
            fireMoved(200, 200);
            fireMoved(250, 250);
            fireMoved(300, 300);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(401);
        });
        expect(setOverlayPositionMock).toHaveBeenCalledTimes(1);
        expect(setOverlayPositionMock).toHaveBeenCalledWith({ x: 300, y: 300 });
    });

    it('cancels the pending save when unmounted before the debounce fires', async () => {
        const { unmount } = render(<OverlayApp />);
        await waitFor(() => expect(onMovedMock).toHaveBeenCalled());
        vi.useFakeTimers();
        act(() => {
            fireMoved(200, 300);
        });
        unmount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });
        expect(setOverlayPositionMock).not.toHaveBeenCalled();
    });
});

describe('<OverlayApp /> setup mode', () => {
    it('renders the positioning pill when setup-on event arrives', async () => {
        render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(SETUP_ON_EVENT, expect.any(Function)),
        );
        await act(async () => {
            fireEvent(SETUP_ON_EVENT, null);
        });
        const pill = await screen.findByTestId('overlay-pill');
        expect(pill).toHaveAttribute('data-state', 'positioning');
        expect(pill).toHaveTextContent(/drag to position/i);
    });

    it('hides the positioning pill when setup-off event arrives', async () => {
        const { container } = render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(SETUP_ON_EVENT, expect.any(Function)),
        );
        await act(async () => {
            fireEvent(SETUP_ON_EVENT, null);
        });
        await screen.findByTestId('overlay-pill');
        await act(async () => {
            fireEvent(SETUP_OFF_EVENT, null);
        });
        await waitFor(() => {
            expect(container.querySelector('[data-testid="overlay-pill"]')).toBeNull();
        });
    });

    it('exits setup mode when a recording event arrives (recording wins)', async () => {
        render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(SETUP_ON_EVENT, expect.any(Function)),
        );
        await act(async () => {
            fireEvent(SETUP_ON_EVENT, null);
        });
        await screen.findByTestId('overlay-pill');
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'recording', sessionId: 'session-1' });
        });
        await waitFor(() => {
            expect(exitOverlayPositionSetupMock).toHaveBeenCalledWith({
                hide: false,
                reason: 'recording-wins',
            });
        });
        // While in setup, recording event arrives → pill is now in 'recording' state
        const pill = screen.getByTestId('overlay-pill');
        expect(pill).toHaveAttribute('data-state', 'recording');
    });

    it('does not arm the idle-exit timer until the user actually moves the pill', async () => {
        render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(SETUP_ON_EVENT, expect.any(Function)),
        );
        await act(async () => {
            fireEvent(SETUP_ON_EVENT, null);
        });
        vi.useFakeTimers();
        // 4 seconds elapse without any drag — should NOT exit
        await act(async () => {
            await vi.advanceTimersByTimeAsync(4000);
        });
        expect(exitOverlayPositionSetupMock).not.toHaveBeenCalled();
    });

    it('exits setup mode 3s after the last drag', async () => {
        render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(SETUP_ON_EVENT, expect.any(Function)),
        );
        await waitFor(() => expect(onMovedMock).toHaveBeenCalled());
        await act(async () => {
            fireEvent(SETUP_ON_EVENT, null);
        });
        vi.useFakeTimers();
        act(() => {
            fireMoved(100, 100);
        });
        // Less than 3s — should not have exited
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2500);
        });
        expect(exitOverlayPositionSetupMock).not.toHaveBeenCalled();
        // Past 3s — exit fires
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
        });
        expect(exitOverlayPositionSetupMock).toHaveBeenCalledWith({
            hide: true,
            reason: 'idle',
        });
    });

    it('resets the idle-exit timer on each subsequent move', async () => {
        render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(SETUP_ON_EVENT, expect.any(Function)),
        );
        await waitFor(() => expect(onMovedMock).toHaveBeenCalled());
        await act(async () => {
            fireEvent(SETUP_ON_EVENT, null);
        });
        vi.useFakeTimers();
        act(() => {
            fireMoved(100, 100);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2500);
        });
        // User drags again before 3s elapse — timer resets
        act(() => {
            fireMoved(200, 200);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2500);
        });
        // Total 5s but idle for only 2.5s since last drag — no exit yet
        expect(exitOverlayPositionSetupMock).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(600);
        });
        expect(exitOverlayPositionSetupMock).toHaveBeenCalledTimes(1);
    });
});

describe('<OverlayApp /> level polling', () => {
    it('polls getRecordingLevel while recording and forwards the level to the pill', async () => {
        getRecordingLevelMock.mockResolvedValue(0.8);
        render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(RECORDING_EVENT, expect.any(Function)),
        );
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'recording', sessionId: 'session-1' });
        });
        await waitFor(() => {
            expect(getRecordingLevelMock).toHaveBeenCalledWith('session-1');
        });
        // The waveform reflects the polled level: the highest-threshold bar
        // (0.7) should be active for level=0.8.
        await waitFor(() => {
            const bar = screen.getByTestId('overlay-waveform-bar-3');
            expect(bar).toHaveAttribute('data-active', 'true');
        });
    });

    it('stops polling when the recording state transitions away', async () => {
        render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(RECORDING_EVENT, expect.any(Function)),
        );
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'recording', sessionId: 'session-1' });
        });
        await waitFor(() => expect(getRecordingLevelMock).toHaveBeenCalled());
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'transcribing' });
        });
        getRecordingLevelMock.mockClear();
        // Give any straggler interval ticks time to fire — they should not.
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(getRecordingLevelMock).not.toHaveBeenCalled();
    });

    it('does not poll while idle', async () => {
        render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(RECORDING_EVENT, expect.any(Function)),
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(getRecordingLevelMock).not.toHaveBeenCalled();
    });

    it('swallows getRecordingLevel errors and keeps polling', async () => {
        getRecordingLevelMock.mockRejectedValueOnce(new Error('stale session'));
        getRecordingLevelMock.mockResolvedValue(0.4);
        render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(RECORDING_EVENT, expect.any(Function)),
        );
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'recording', sessionId: 'session-1' });
        });
        // At least two calls: the rejected one + a follow-up.
        await waitFor(
            () => {
                expect(getRecordingLevelMock.mock.calls.length).toBeGreaterThanOrEqual(2);
            },
            { timeout: 1000 },
        );
        // No unhandled-promise crash brought the pill down.
        expect(screen.getByTestId('overlay-pill')).toBeInTheDocument();
    });
});

describe('<OverlayApp /> reset handler', () => {
    it('applies the default position when reset event arrives', async () => {
        render(<OverlayApp />);
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(RESET_EVENT, expect.any(Function)),
        );
        const callsBefore = setPositionMock.mock.calls.length;
        await act(async () => {
            fireEvent(RESET_EVENT, null);
        });
        await waitFor(() => {
            expect(setPositionMock.mock.calls.length).toBeGreaterThan(callsBefore);
        });
        const arg = setPositionMock.mock.calls.at(-1)?.[0];
        expect(arg?.x).toBe(820);
        expect(arg?.y).toBe(936);
    });
});
