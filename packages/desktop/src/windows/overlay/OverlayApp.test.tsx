import { act, fireEvent as domEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    listenMock,
    fireEvent,
    availableMonitorsMock,
    scaleFactorMock,
    setPositionMock,
    onMovedMock,
    fireMoved,
    setOverlayPlacementMock,
    getPlatformMock,
    QHD,
    exitOverlayPositionSetupMock,
    getRecordingLevelMock,
    getOverlaySensitivityMock,
    hideMock,
    showMainWindowMock,
} = vi.hoisted(() => {
    type Handler = (event: { payload: unknown }) => void;
    const handlers = new Map<string, Handler>();
    let movedHandler: ((e: { payload: { x: number; y: number } }) => void) | null = null;
    // Main ultrawide plus a DisplayLink-driven panel to its right.
    const ULTRAWIDE = {
        name: 'Monitor #45574',
        position: { x: 0, y: 0 },
        size: { width: 3440, height: 1440 },
        scaleFactor: 1,
    };
    const QHD = {
        name: 'Monitor #23698',
        position: { x: 3440, y: -217 },
        size: { width: 2560, height: 1440 },
        scaleFactor: 1,
    };
    return {
        listenMock: vi.fn(async (name: string, h: Handler) => {
            handlers.set(name, h);
            return () => {
                if (handlers.get(name) === h) handlers.delete(name);
            };
        }),
        fireEvent: (name: string, payload: unknown) => handlers.get(name)?.({ payload }),
        availableMonitorsMock: vi.fn(async (): Promise<unknown[]> => [ULTRAWIDE, QHD]),
        scaleFactorMock: vi.fn(async () => 1),
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
        setOverlayPlacementMock: vi.fn(async (_p: unknown) => undefined),
        getPlatformMock: vi.fn(async () => ({ os: 'macos', isWayland: false })),
        QHD,
        exitOverlayPositionSetupMock: vi.fn<(opts?: { hide: boolean }) => Promise<void>>(
            async () => undefined,
        ),
        getRecordingLevelMock: vi.fn<(sessionId: string) => Promise<number>>(async () => 0),
        getOverlaySensitivityMock: vi.fn(async () => 1),
        hideMock: vi.fn(async () => undefined),
        showMainWindowMock: vi.fn(async () => undefined),
    };
});

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('@tauri-apps/api/window', () => ({
    listen: listenMock,
    availableMonitors: availableMonitorsMock,
    getCurrentWindow: () => ({
        setPosition: setPositionMock,
        onMoved: onMovedMock,
        scaleFactor: scaleFactorMock,
        startDragging: vi.fn(async () => undefined),
        hide: hideMock,
    }),
}));
vi.mock('@/lib/db', () => ({
    setOverlayPlacement: setOverlayPlacementMock,
    getOverlaySensitivity: getOverlaySensitivityMock,
}));
vi.mock('@/lib/use-platform', () => ({ getPlatform: getPlatformMock }));
vi.mock('@/lib/overlay-bridge', () => ({
    RECORDING_STATE_EVENT: 'bluemacaw://recording-state',
    OVERLAY_POSITION_SETUP_ON_EVENT: 'bluemacaw://overlay-position-setup-on',
    OVERLAY_POSITION_SETUP_OFF_EVENT: 'bluemacaw://overlay-position-setup-off',
    exitOverlayPositionSetup: exitOverlayPositionSetupMock,
}));
vi.mock('@/lib/invoke', () => ({
    vox: { getRecordingLevel: getRecordingLevelMock, showMainWindow: showMainWindowMock },
}));

import { OverlayApp } from './OverlayApp';

const RECORDING_EVENT = 'bluemacaw://recording-state';
const SETUP_ON_EVENT = 'bluemacaw://overlay-position-setup-on';
const SETUP_OFF_EVENT = 'bluemacaw://overlay-position-setup-off';

/** Show the recording chip and wait until its move listener is attached. */
async function showRecordingChip() {
    await waitFor(() =>
        expect(listenMock).toHaveBeenCalledWith(RECORDING_EVENT, expect.any(Function)),
    );
    await waitFor(() => expect(onMovedMock).toHaveBeenCalled());
    await act(async () => {
        fireEvent(RECORDING_EVENT, { kind: 'recording', sessionId: 'session-1' });
    });
    await screen.findByTestId('overlay-pill');
}

function grabHandle() {
    domEvent.mouseDown(screen.getByTestId('overlay-drag-handle'), { button: 0 });
}

/** Let the debounced save fire and its async lookups settle. */
async function settleSave() {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(401);
    });
}

beforeEach(() => {
    listenMock.mockClear();
    scaleFactorMock.mockReset().mockResolvedValue(1);
    setOverlayPlacementMock.mockReset().mockResolvedValue(undefined);
    setPositionMock.mockClear();
    onMovedMock.mockClear();
    exitOverlayPositionSetupMock.mockReset().mockResolvedValue(undefined);
    getRecordingLevelMock.mockReset().mockResolvedValue(0);
    getOverlaySensitivityMock.mockReset().mockResolvedValue(1);
    hideMock.mockReset().mockResolvedValue(undefined);
    showMainWindowMock.mockReset().mockResolvedValue(undefined);
    vi.useRealTimers();
});

describe('<OverlayApp />', () => {
    it('renders nothing initially (idle → hidden)', () => {
        const { container } = render(<OverlayApp />);
        expect(container).toBeEmptyDOMElement();
    });

    it('never positions the window itself; the bridge places it before each show', async () => {
        render(<OverlayApp />);
        await waitFor(() => expect(onMovedMock).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(setPositionMock).not.toHaveBeenCalled();
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

    /** Mount, wait for the listener, and deliver an error state. */
    async function showError(message = 'boom') {
        await waitFor(() =>
            expect(listenMock).toHaveBeenCalledWith(RECORDING_EVENT, expect.any(Function)),
        );
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'error', message });
        });
    }

    it('shows an error on the pill instead of hiding', async () => {
        render(<OverlayApp />);
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'recording', sessionId: 'session-1' });
        });
        await showError('No model selected');

        const pill = await screen.findByTestId('overlay-pill');
        expect(pill).toHaveAttribute('data-state', 'error');
        expect(pill).toHaveTextContent('No model selected');
        expect(hideMock).not.toHaveBeenCalled();
    });

    it('takes the error down, and hides the window, after eight seconds', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { container } = render(<OverlayApp />);
        await showError();
        await screen.findByTestId('overlay-pill');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(7_900);
        });
        expect(screen.getByTestId('overlay-pill')).toBeInTheDocument();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(200);
        });
        expect(container.querySelector('[data-testid="overlay-pill"]')).toBeNull();
        expect(hideMock).toHaveBeenCalledTimes(1);
    });

    it('dismisses the error when the user closes it', async () => {
        const { container } = render(<OverlayApp />);
        await showError();
        domEvent.click(await screen.findByRole('button', { name: /dismiss/i }));

        await waitFor(() => {
            expect(container.querySelector('[data-testid="overlay-pill"]')).toBeNull();
        });
        expect(hideMock).toHaveBeenCalledTimes(1);
    });

    it('opens the main window when the error is clicked, and takes the pill down', async () => {
        const { container } = render(<OverlayApp />);
        await showError();
        domEvent.click(await screen.findByRole('button', { name: /open bluemacaw/i }));

        await waitFor(() => expect(showMainWindowMock).toHaveBeenCalledTimes(1));
        expect(container.querySelector('[data-testid="overlay-pill"]')).toBeNull();
        expect(hideMock).toHaveBeenCalledTimes(1);
    });

    it('lets a new recording replace the error without hiding the window', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        render(<OverlayApp />);
        await showError();
        await screen.findByTestId('overlay-pill');

        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'recording', sessionId: 'session-2' });
        });
        expect(screen.getByTestId('overlay-pill')).toHaveAttribute('data-state', 'recording');

        // The error's timer must not hide the pill that now shows a recording.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(9_000);
        });
        expect(screen.getByTestId('overlay-pill')).toHaveAttribute('data-state', 'recording');
        expect(hideMock).not.toHaveBeenCalled();
    });

    it('shows the same error again when it happens a second time', async () => {
        const { container } = render(<OverlayApp />);
        await showError('No model selected');
        domEvent.click(await screen.findByRole('button', { name: /dismiss/i }));
        await waitFor(() => {
            expect(container.querySelector('[data-testid="overlay-pill"]')).toBeNull();
        });

        await showError('No model selected');

        expect(await screen.findByTestId('overlay-pill')).toHaveAttribute('data-state', 'error');
    });

    it('saves where the user dropped the chip: the monitor and the offset inside it', async () => {
        render(<OverlayApp />);
        await showRecordingChip();
        vi.useFakeTimers();
        grabHandle();
        act(() => {
            fireMoved(3440 + 1700, -217 + 90);
        });
        expect(setOverlayPlacementMock).not.toHaveBeenCalled();
        await settleSave();
        expect(setOverlayPlacementMock).toHaveBeenCalledTimes(1);
        expect(setOverlayPlacementMock).toHaveBeenCalledWith({
            monitorName: QHD.name,
            monitorX: 3440,
            monitorY: -217,
            monitorWidth: 2560,
            monitorHeight: 1440,
            offsetX: 1700,
            offsetY: 90,
        });
    });

    // Regression: macOS moves the window on its own whenever the display
    // layout changes (a DisplayLink monitor attaching after login, waking
    // from sleep, undocking). Those moves used to be saved as if the user
    // had chosen them, overwriting the real position.
    it('does not save a move the user did not make', async () => {
        render(<OverlayApp />);
        await showRecordingChip();
        vi.useFakeTimers();
        act(() => {
            fireMoved(5136, 1115);
        });
        await settleSave();
        expect(setOverlayPlacementMock).not.toHaveBeenCalled();
    });

    it('does not save a move while the chip is hidden', async () => {
        render(<OverlayApp />);
        await waitFor(() => expect(onMovedMock).toHaveBeenCalled());
        vi.useFakeTimers();
        act(() => {
            fireMoved(5136, 1115);
        });
        await settleSave();
        expect(setOverlayPlacementMock).not.toHaveBeenCalled();
    });

    it('stops treating moves as a drag once the chip hides', async () => {
        render(<OverlayApp />);
        await showRecordingChip();
        vi.useFakeTimers();
        grabHandle();
        act(() => {
            fireMoved(200, 300);
        });
        await settleSave();
        expect(setOverlayPlacementMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'idle' });
        });
        act(() => {
            fireMoved(5136, 1115);
        });
        await settleSave();
        expect(setOverlayPlacementMock).toHaveBeenCalledTimes(1);
    });

    it('still saves a drop made just before the chip hides', async () => {
        render(<OverlayApp />);
        await showRecordingChip();
        vi.useFakeTimers();
        grabHandle();
        act(() => {
            fireMoved(200, 300);
        });
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'idle' });
        });
        await settleSave();
        expect(setOverlayPlacementMock).toHaveBeenCalledTimes(1);
        expect(setOverlayPlacementMock.mock.calls[0]?.[0]).toMatchObject({
            offsetX: 200,
            offsetY: 300,
        });
    });

    it('debounces a drag into one save with the last position', async () => {
        render(<OverlayApp />);
        await showRecordingChip();
        vi.useFakeTimers();
        grabHandle();
        act(() => {
            fireMoved(100, 100);
            fireMoved(150, 150);
            fireMoved(200, 200);
            fireMoved(250, 250);
            fireMoved(300, 300);
        });
        await settleSave();
        expect(setOverlayPlacementMock).toHaveBeenCalledTimes(1);
        expect(setOverlayPlacementMock.mock.calls[0]?.[0]).toMatchObject({
            offsetX: 300,
            offsetY: 300,
        });
    });

    it('cancels the pending save when unmounted before the debounce fires', async () => {
        const { unmount } = render(<OverlayApp />);
        await showRecordingChip();
        vi.useFakeTimers();
        grabHandle();
        act(() => {
            fireMoved(200, 300);
        });
        unmount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });
        expect(setOverlayPlacementMock).not.toHaveBeenCalled();
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
    it('loads saved sensitivity and responds to changes from the settings window', async () => {
        getOverlaySensitivityMock.mockResolvedValue(0.2);
        getRecordingLevelMock.mockResolvedValue(0.12);
        render(<OverlayApp />);
        await waitFor(() => expect(getOverlaySensitivityMock).toHaveBeenCalled());
        await act(async () => {
            fireEvent(RECORDING_EVENT, { kind: 'recording', sessionId: 'session-1' });
        });
        const bar = await screen.findByTestId('overlay-waveform-bar-3');
        expect(bar).toHaveAttribute('data-active', 'false');
        getOverlaySensitivityMock.mockResolvedValue(2);
        await act(async () => {
            fireEvent('bluemacaw://overlay-sensitivity-changed', null);
        });
        await waitFor(() => expect(bar).toHaveAttribute('data-active', 'true'));
    });

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
