import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    emitMock,
    getByLabelMock,
    fakeOverlay,
    getOverlayEnabledMock,
    getOverlayPlacementMock,
    getOverlayPositionMock,
    clearOverlayPlacementMock,
    presentOverlayMock,
    availableMonitorsMock,
    primaryMonitorMock,
    getPlatformMock,
    ULTRAWIDE,
    QHD,
} = vi.hoisted(() => {
    type Positioned = { kind: 'logical' | 'physical'; x: number; y: number };
    const fakeOverlay = {
        show: vi.fn(async () => undefined),
        hide: vi.fn(async () => undefined),
        isVisible: vi.fn(async () => false),
        setPosition: vi.fn(async (_p: Positioned) => undefined),
    };
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
        emitMock: vi.fn(async () => undefined),
        getByLabelMock: vi.fn(async (_label: string) => fakeOverlay as unknown),
        fakeOverlay,
        getOverlayEnabledMock: vi.fn(async () => true),
        getOverlayPlacementMock: vi.fn(async (): Promise<unknown> => null),
        getOverlayPositionMock: vi.fn(async (): Promise<unknown> => null),
        clearOverlayPlacementMock: vi.fn(async () => undefined),
        // Show now routes through the Rust `present_overlay` command
        // (vox.presentOverlay) so the pill lands on the active Space.
        presentOverlayMock: vi.fn(async () => undefined),
        availableMonitorsMock: vi.fn(async (): Promise<unknown[]> => [ULTRAWIDE, QHD]),
        primaryMonitorMock: vi.fn(async (): Promise<unknown> => ULTRAWIDE),
        getPlatformMock: vi.fn(async () => ({ os: 'macos', isWayland: false })),
        ULTRAWIDE,
        QHD,
    };
});

vi.mock('@tauri-apps/api/event', () => ({ emit: emitMock }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    WebviewWindow: { getByLabel: getByLabelMock },
}));
vi.mock('@tauri-apps/api/window', () => ({
    availableMonitors: availableMonitorsMock,
    primaryMonitor: primaryMonitorMock,
    LogicalPosition: class {
        kind = 'logical';
        constructor(
            public x: number,
            public y: number,
        ) {}
    },
    PhysicalPosition: class {
        kind = 'physical';
        constructor(
            public x: number,
            public y: number,
        ) {}
    },
}));
vi.mock('./db', () => ({
    getOverlayEnabled: getOverlayEnabledMock,
    getOverlayPlacement: getOverlayPlacementMock,
    getOverlayPosition: getOverlayPositionMock,
    clearOverlayPlacement: clearOverlayPlacementMock,
}));
vi.mock('./invoke', () => ({ vox: { presentOverlay: presentOverlayMock } }));
vi.mock('./use-platform', () => ({ getPlatform: getPlatformMock }));

import { EVT_SHORTCUT_CANCEL, EVT_SHORTCUT_TOGGLE } from './markers';
import {
    OVERLAY_POSITION_SETUP_OFF_EVENT,
    OVERLAY_POSITION_SETUP_ON_EVENT,
    RECORDING_STATE_EVENT,
    __resetPublishSeqForTests,
    enterOverlayPositionSetup,
    exitOverlayPositionSetup,
    hideOverlayWindow,
    publishRecordingState,
    requestRecordingCancel,
    requestRecordingToggle,
    resetOverlayPosition,
} from './overlay-bridge';

beforeEach(() => {
    emitMock.mockClear();
    getByLabelMock.mockReset().mockResolvedValue(fakeOverlay);
    fakeOverlay.show.mockClear();
    fakeOverlay.hide.mockClear();
    fakeOverlay.isVisible.mockReset().mockResolvedValue(false);
    fakeOverlay.setPosition.mockReset().mockResolvedValue(undefined);
    getOverlayPlacementMock.mockReset().mockResolvedValue(null);
    getOverlayPositionMock.mockReset().mockResolvedValue(null);
    clearOverlayPlacementMock.mockReset().mockResolvedValue(undefined);
    availableMonitorsMock.mockReset().mockResolvedValue([ULTRAWIDE, QHD]);
    primaryMonitorMock.mockReset().mockResolvedValue(ULTRAWIDE);
    getPlatformMock.mockReset().mockResolvedValue({ os: 'macos', isWayland: false });
    presentOverlayMock.mockReset().mockResolvedValue(undefined);
    getOverlayEnabledMock.mockReset().mockResolvedValue(true);
    __resetPublishSeqForTests();
});

describe('publishRecordingState (overlay enabled)', () => {
    it('emits the recording-state event with the payload', async () => {
        await publishRecordingState({ kind: 'idle' });
        expect(emitMock).toHaveBeenCalledWith(RECORDING_STATE_EVENT, { kind: 'idle' });
    });

    it('presents the overlay on the active Space on recording', async () => {
        await publishRecordingState({ kind: 'recording', sessionId: 'session-1', startedAt: 0 });
        expect(presentOverlayMock).toHaveBeenCalled();
        expect(fakeOverlay.hide).not.toHaveBeenCalled();
    });

    it('presents the overlay on transcribing', async () => {
        await publishRecordingState({ kind: 'transcribing' });
        expect(presentOverlayMock).toHaveBeenCalled();
        expect(fakeOverlay.hide).not.toHaveBeenCalled();
    });

    it('hides the overlay window on idle', async () => {
        await publishRecordingState({ kind: 'idle' });
        expect(fakeOverlay.hide).toHaveBeenCalled();
        expect(presentOverlayMock).not.toHaveBeenCalled();
    });

    it('presents the overlay on error, so the user sees what went wrong', async () => {
        await publishRecordingState({ kind: 'error', message: 'boom' });
        expect(presentOverlayMock).toHaveBeenCalledTimes(1);
        expect(fakeOverlay.hide).not.toHaveBeenCalled();
    });

    it('does not throw if presenting fails', async () => {
        presentOverlayMock.mockRejectedValueOnce(new Error('boom'));
        await expect(
            publishRecordingState({ kind: 'recording', sessionId: 's', startedAt: 0 }),
        ).resolves.not.toThrow();
    });

    it('does not throw if hide fails', async () => {
        fakeOverlay.hide.mockRejectedValueOnce(new Error('boom'));
        await expect(publishRecordingState({ kind: 'idle' })).resolves.not.toThrow();
    });
});

describe('publishRecordingState (overlay disabled)', () => {
    beforeEach(() => {
        getOverlayEnabledMock.mockResolvedValue(false);
    });

    it('hides the overlay window on recording (no present)', async () => {
        await publishRecordingState({ kind: 'recording', sessionId: 's', startedAt: 0 });
        expect(presentOverlayMock).not.toHaveBeenCalled();
        expect(fakeOverlay.hide).toHaveBeenCalled();
    });

    it('hides the overlay window on transcribing (no present)', async () => {
        await publishRecordingState({ kind: 'transcribing' });
        expect(presentOverlayMock).not.toHaveBeenCalled();
        expect(fakeOverlay.hide).toHaveBeenCalled();
    });

    it('still presents an error: with the pill off there is no other sign of a failure', async () => {
        await publishRecordingState({ kind: 'error', message: 'boom' });
        expect(presentOverlayMock).toHaveBeenCalledTimes(1);
        expect(fakeOverlay.hide).not.toHaveBeenCalled();
    });

    it('still emits the recording-state event for the main window pill', async () => {
        await publishRecordingState({ kind: 'recording', sessionId: 's', startedAt: 0 });
        expect(emitMock).toHaveBeenCalled();
    });
});

describe('publishRecordingState (getOverlayEnabled fails)', () => {
    it('falls back to presenting on recording', async () => {
        getOverlayEnabledMock.mockRejectedValueOnce(new Error('db boom'));
        await publishRecordingState({ kind: 'recording', sessionId: 's', startedAt: 0 });
        expect(presentOverlayMock).toHaveBeenCalled();
    });
});

describe('publishRecordingState (concurrent transitions)', () => {
    /**
     * Regression: a fast transcription that runs `recording → transcribing
     * → idle` in quick succession used to leave the overlay pill stuck in
     * "Transcribing…". The `transcribing` publish awaits `getOverlayEnabled`
     * before presenting; the `idle` publish skips that await and hides
     * immediately. Without sequence guarding, the stale present runs after
     * the fresh hide and re-shows the pill.
     */
    it('drops the stale transcribing present when an idle hide raced ahead', async () => {
        let releaseSlowGet: (v: boolean) => void = () => {};
        getOverlayEnabledMock.mockImplementationOnce(
            () =>
                new Promise<boolean>((resolve) => {
                    releaseSlowGet = resolve;
                }),
        );

        const transcribingPromise = publishRecordingState({ kind: 'transcribing' });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        await publishRecordingState({ kind: 'idle' });

        expect(fakeOverlay.hide).toHaveBeenCalledTimes(1);
        expect(presentOverlayMock).not.toHaveBeenCalled();

        releaseSlowGet(true);
        await transcribingPromise;

        expect(presentOverlayMock).not.toHaveBeenCalled();
        expect(fakeOverlay.hide).toHaveBeenCalledTimes(1);
    });
});

describe('publishRecordingState (chip placement)', () => {
    const savedOnQhd = {
        monitorName: QHD.name,
        monitorX: 3440,
        monitorY: -217,
        monitorWidth: 2560,
        monitorHeight: 1440,
        offsetX: 1700,
        offsetY: 90,
    };

    function lastPosition() {
        return fakeOverlay.setPosition.mock.calls.at(-1)?.[0];
    }

    it('centers the chip at the bottom of the primary monitor when nothing is saved', async () => {
        await publishRecordingState({ kind: 'recording', sessionId: 's1', startedAt: 0 });
        expect(lastPosition()).toMatchObject({ kind: 'logical', x: 1580, y: 1296 });
    });

    it('puts the chip back on the monitor and offset the user chose', async () => {
        getOverlayPlacementMock.mockResolvedValue(savedOnQhd);
        await publishRecordingState({ kind: 'recording', sessionId: 's1', startedAt: 0 });
        expect(lastPosition()).toMatchObject({ kind: 'logical', x: 3440 + 1700, y: -217 + 90 });
    });

    it('positions the chip before showing it', async () => {
        await publishRecordingState({ kind: 'recording', sessionId: 's1', startedAt: 0 });
        expect(fakeOverlay.setPosition.mock.invocationCallOrder[0]).toBeLessThan(
            presentOverlayMock.mock.invocationCallOrder[0] ?? 0,
        );
    });

    it('re-resolves against the monitors connected at each show', async () => {
        getOverlayPlacementMock.mockResolvedValue(savedOnQhd);
        // At login the DisplayLink monitor has not attached yet.
        availableMonitorsMock.mockResolvedValueOnce([ULTRAWIDE]);
        await publishRecordingState({ kind: 'recording', sessionId: 's1', startedAt: 0 });
        expect(lastPosition()).toMatchObject({ x: 1580, y: 1296 });

        await publishRecordingState({ kind: 'idle' });
        await publishRecordingState({ kind: 'recording', sessionId: 's2', startedAt: 0 });
        expect(lastPosition()).toMatchObject({ x: 3440 + 1700, y: -217 + 90 });
    });

    it('never forgets the saved placement while its monitor is away', async () => {
        getOverlayPlacementMock.mockResolvedValue(savedOnQhd);
        availableMonitorsMock.mockResolvedValue([ULTRAWIDE]);
        await publishRecordingState({ kind: 'recording', sessionId: 's1', startedAt: 0 });
        expect(clearOverlayPlacementMock).not.toHaveBeenCalled();
    });

    it('honours a position saved by an older build', async () => {
        getOverlayPositionMock.mockResolvedValue({ x: 1696, y: 1332 });
        await publishRecordingState({ kind: 'recording', sessionId: 's1', startedAt: 0 });
        expect(lastPosition()).toMatchObject({ kind: 'logical', x: 1696, y: 1332 });
    });

    it('addresses the window in physical pixels off macOS', async () => {
        getPlatformMock.mockResolvedValue({ os: 'windows', isWayland: false });
        const scaled = {
            name: '\\\\.\\DISPLAY1',
            position: { x: 0, y: 0 },
            size: { width: 2880, height: 1620 },
            scaleFactor: 1.5,
        };
        availableMonitorsMock.mockResolvedValue([scaled]);
        primaryMonitorMock.mockResolvedValue(scaled);
        await publishRecordingState({ kind: 'recording', sessionId: 's1', startedAt: 0 });
        expect(lastPosition()).toMatchObject({ kind: 'physical', x: 1230, y: 1404 });
    });

    it('leaves a chip that is already on screen where it is', async () => {
        fakeOverlay.isVisible.mockResolvedValue(true);
        await publishRecordingState({ kind: 'transcribing' });
        expect(fakeOverlay.setPosition).not.toHaveBeenCalled();
        expect(presentOverlayMock).toHaveBeenCalledTimes(1);
    });

    it('still shows the chip when placement fails', async () => {
        availableMonitorsMock.mockRejectedValue(new Error('no display server'));
        await publishRecordingState({ kind: 'recording', sessionId: 's1', startedAt: 0 });
        expect(presentOverlayMock).toHaveBeenCalledTimes(1);
    });

    it('does not show the chip if an idle transition arrived while placing it', async () => {
        let releaseMonitors: (v: unknown[]) => void = () => {};
        availableMonitorsMock.mockImplementationOnce(
            () =>
                new Promise<unknown[]>((resolve) => {
                    releaseMonitors = resolve;
                }),
        );
        const recording = publishRecordingState({
            kind: 'recording',
            sessionId: 's1',
            startedAt: 0,
        });
        await vi.waitFor(() => expect(availableMonitorsMock).toHaveBeenCalled());
        await publishRecordingState({ kind: 'idle' });
        releaseMonitors([ULTRAWIDE, QHD]);
        await recording;
        expect(presentOverlayMock).not.toHaveBeenCalled();
    });
});

describe('hideOverlayWindow', () => {
    it('calls overlay.hide()', async () => {
        await hideOverlayWindow();
        expect(fakeOverlay.hide).toHaveBeenCalled();
    });

    it('does not throw if overlay is missing', async () => {
        getByLabelMock.mockResolvedValueOnce(null);
        await expect(hideOverlayWindow()).resolves.not.toThrow();
    });

    it('does not throw if hide fails', async () => {
        fakeOverlay.hide.mockRejectedValueOnce(new Error('boom'));
        await expect(hideOverlayWindow()).resolves.not.toThrow();
    });
});

describe('enterOverlayPositionSetup', () => {
    it('emits setup-on and presents the overlay', async () => {
        await enterOverlayPositionSetup();
        expect(emitMock).toHaveBeenCalledWith(OVERLAY_POSITION_SETUP_ON_EVENT, null);
        expect(presentOverlayMock).toHaveBeenCalled();
    });

    it('does not throw if presenting fails', async () => {
        presentOverlayMock.mockRejectedValueOnce(new Error('boom'));
        await expect(enterOverlayPositionSetup()).resolves.not.toThrow();
    });

    it('places the chip before presenting it', async () => {
        await enterOverlayPositionSetup();
        expect(fakeOverlay.setPosition.mock.calls[0]?.[0]).toMatchObject({ x: 1580, y: 1296 });
        expect(fakeOverlay.setPosition.mock.invocationCallOrder[0]).toBeLessThan(
            presentOverlayMock.mock.invocationCallOrder[0] ?? 0,
        );
    });
});

describe('exitOverlayPositionSetup', () => {
    it('emits setup-off (default reason "manual") and hides by default', async () => {
        await exitOverlayPositionSetup();
        expect(emitMock).toHaveBeenCalledWith(OVERLAY_POSITION_SETUP_OFF_EVENT, {
            reason: 'manual',
        });
        expect(fakeOverlay.hide).toHaveBeenCalled();
    });

    it('emits setup-off with the supplied reason', async () => {
        await exitOverlayPositionSetup({ hide: true, reason: 'idle' });
        expect(emitMock).toHaveBeenCalledWith(OVERLAY_POSITION_SETUP_OFF_EVENT, {
            reason: 'idle',
        });
    });

    it('emits setup-off but does not hide when hide:false', async () => {
        await exitOverlayPositionSetup({ hide: false, reason: 'recording-wins' });
        expect(emitMock).toHaveBeenCalledWith(OVERLAY_POSITION_SETUP_OFF_EVENT, {
            reason: 'recording-wins',
        });
        expect(fakeOverlay.hide).not.toHaveBeenCalled();
    });

    it('does not throw if emit fails', async () => {
        emitMock.mockRejectedValueOnce(new Error('boom'));
        await expect(exitOverlayPositionSetup()).resolves.not.toThrow();
    });
});

describe('resetOverlayPosition', () => {
    it('forgets the saved placement', async () => {
        await resetOverlayPosition();
        expect(clearOverlayPlacementMock).toHaveBeenCalledTimes(1);
    });

    it('moves a visible chip back to the default spot', async () => {
        fakeOverlay.isVisible.mockResolvedValue(true);
        await resetOverlayPosition();
        expect(fakeOverlay.setPosition.mock.calls.at(-1)?.[0]).toMatchObject({
            kind: 'logical',
            x: 1580,
            y: 1296,
        });
    });

    it('leaves a hidden chip alone; the next show places it', async () => {
        await resetOverlayPosition();
        expect(fakeOverlay.setPosition).not.toHaveBeenCalled();
    });

    it('does not throw if clearing fails', async () => {
        clearOverlayPlacementMock.mockRejectedValueOnce(new Error('boom'));
        await expect(resetOverlayPosition()).resolves.not.toThrow();
    });
});

describe('requestRecordingToggle', () => {
    it('emits the same event the OS hotkey fires', async () => {
        await requestRecordingToggle();
        expect(emitMock).toHaveBeenCalledWith(EVT_SHORTCUT_TOGGLE, null);
    });

    it('does not throw if emit fails', async () => {
        emitMock.mockRejectedValueOnce(new Error('boom'));
        await expect(requestRecordingToggle()).resolves.not.toThrow();
    });
});

describe('requestRecordingCancel', () => {
    it('emits the same event the cancel hotkey fires', async () => {
        await requestRecordingCancel();
        expect(emitMock).toHaveBeenCalledWith(EVT_SHORTCUT_CANCEL, null);
    });

    it('does not throw if emit fails', async () => {
        emitMock.mockRejectedValueOnce(new Error('boom'));
        await expect(requestRecordingCancel()).resolves.not.toThrow();
    });
});
