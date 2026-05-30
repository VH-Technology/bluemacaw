import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
    listApiKeys: vi.fn(async () => []),
    listModelConfigs: vi.fn(async () => []),
    getActiveModelConfigId: vi.fn(async () => null),
    getOverlayEnabled: vi.fn(async () => true),
    setOverlayEnabled: vi.fn(async () => undefined),
    listTranscriptions: vi.fn(async () => []),
    softDeleteTranscription: vi.fn(async () => undefined),
    restoreTranscription: vi.fn(async () => undefined),
    getSelectedMicDeviceId: vi.fn(async () => null),
    setSelectedMicDeviceId: vi.fn(async () => undefined),
    getHotkeyCombo: vi.fn(async () => 'Cmd+Shift+Space'),
    setHotkeyCombo: vi.fn(async () => undefined),
    getCancelHotkeyCombo: vi.fn(async () => 'Cmd+Esc'),
    setCancelHotkeyCombo: vi.fn(async () => undefined),
    // Used by the predicate-driven onboarding wizard when the gate routes
    // to show-onboarding. False means "step 2 not yet seen by user."
    getHotkeysOnboarded: vi.fn(async () => false),
    setHotkeysOnboarded: vi.fn(async () => undefined),
    getRetentionDays: vi.fn(async () => 365),
    setRetentionDays: vi.fn(async () => undefined),
    purgeOlderThan: vi.fn(async () => ({ softDeleted: 0, hardDeleted: 0 })),
    clearAllTranscriptions: vi.fn(async () => ({ deleted: 0 })),
    getHistoryStats: vi.fn(async () => ({
        totalWords: 0,
        streakDays: 0,
        avgWPM: null,
        timeSavedMinutes: 0,
        topProvider: null,
    })),
}));

vi.mock('@/lib/invoke', () => ({
    vox: {
        listAudioInputDevices: vi.fn(async () => []),
        startRecording: vi.fn(async () => 'session-id'),
        stopRecording: vi.fn(async () => []),
        registerHotkey: vi.fn(async () => 'Cmd+Shift+Space'),
        unregisterHotkey: vi.fn(async () => undefined),
        registerCancelHotkey: vi.fn(async () => 'Cmd+Esc'),
        unregisterCancelHotkey: vi.fn(async () => undefined),
        getPlatformInfo: vi.fn(async () => ({ os: 'macos', isWayland: false })),
        // OnboardingStepPermissions polls these via useOnboardingStatus
        // whenever the gate routes to show-onboarding. Stub them so the
        // poller doesn't spam errors during the show-onboarding case.
        checkMicrophonePermission: vi.fn(async () => 'Granted'),
        checkAccessibilityPermission: vi.fn(async () => 'Granted'),
        checkInputMonitoringPermission: vi.fn(async () => 'Granted'),
    },
}));

vi.mock('@/lib/overlay-bridge', () => ({
    publishRecordingState: vi.fn(async () => undefined),
    hideOverlayWindow: vi.fn(async () => undefined),
    enterOverlayPositionSetup: vi.fn(async () => undefined),
    exitOverlayPositionSetup: vi.fn(async () => undefined),
    resetOverlayPosition: vi.fn(async () => undefined),
    RECORDING_STATE_EVENT: 'bluemacaw://recording-state',
    OVERLAY_POSITION_SETUP_OFF_EVENT: 'bluemacaw://overlay-position-setup-off',
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => () => undefined),
    emit: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    WebviewWindow: { getByLabel: vi.fn(async () => null) },
}));

// useUpdater pulls in @tauri-apps/plugin-updater, which throws under jsdom
// because it expects the Tauri IPC bridge. Stub it to a quiet idle state.
vi.mock('@tauri-apps/plugin-updater', () => ({
    check: vi.fn(async () => null),
}));

vi.mock('@tauri-apps/api/app', () => ({
    getVersion: vi.fn(async () => '0.1.2'),
}));

vi.mock('@/lib/use-onboarding-gate', () => ({
    useOnboardingGate: vi.fn(() => ({ state: 'show-main', complete: vi.fn() })),
}));

import { useOnboardingGate } from '@/lib/use-onboarding-gate';
import { check } from '@tauri-apps/plugin-updater';
import { MainWindow } from './MainWindow';

describe('<MainWindow />', () => {
    it('renders two tab triggers: Dashboard, Settings', () => {
        render(<MainWindow />);
        expect(screen.getByRole('tab', { name: /dashboard/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
        // History was folded into the Dashboard panel; About was removed.
        expect(screen.queryByRole('tab', { name: /history/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: /about/i })).not.toBeInTheDocument();
    });

    it('shows the Dashboard panel by default', () => {
        render(<MainWindow />);
        const dashboardTab = screen.getByRole('tab', { name: /dashboard/i });
        expect(dashboardTab).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('panel-dashboard')).toBeInTheDocument();
    });

    it('Dashboard panel contains both the Statistics and Recent transcriptions sections', () => {
        render(<MainWindow />);
        const panel = screen.getByTestId('panel-dashboard');
        expect(panel).toContainElement(screen.getByTestId('section-stats'));
        expect(panel).toContainElement(screen.getByTestId('section-history'));
        expect(screen.getByRole('heading', { name: /statistics/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /recent transcriptions/i })).toBeInTheDocument();
    });

    // Windows CI runners are 2-3x slower than macOS/Linux at userEvent.click +
    // Radix Tabs unmount/mount cascade for a panel as heavy as Settings (7
    // setting sub-components, all firing effects on mount). Locally this test
    // settles in ~600ms; on windows-latest it crosses the 5s default.
    it('switches to the Settings panel when its tab is clicked', async () => {
        const user = userEvent.setup();
        render(<MainWindow />);
        await user.click(screen.getByRole('tab', { name: /settings/i }));
        expect(await screen.findByTestId('panel-settings')).toBeInTheDocument();
    }, 15_000);

    it('renders a loading state while the onboarding gate is undecided', () => {
        vi.mocked(useOnboardingGate).mockReturnValueOnce({
            state: 'loading',
            complete: vi.fn(),
        });
        render(<MainWindow />);
        expect(screen.getByTestId('main-loading')).toBeInTheDocument();
    });

    it('renders the OnboardingScreen when the gate says show-onboarding', () => {
        vi.mocked(useOnboardingGate).mockReturnValueOnce({
            state: 'show-onboarding',
            complete: vi.fn(),
        });
        render(<MainWindow />);
        expect(screen.getByTestId('onboarding-screen')).toBeInTheDocument();
    });

    it('surfaces a transient error toast (not a persistent banner) when the update check keeps failing', async () => {
        vi.useFakeTimers();
        vi.mocked(check).mockImplementation(async () => {
            throw new Error('network down');
        });
        try {
            render(<MainWindow />);
            // Exhaust the default backoff schedule (~1+2+4+8 = 15s) so every
            // retry has fired and the hook gives up.
            await act(async () => {
                await vi.advanceTimersByTimeAsync(15_000);
            });
            const toast = screen.getByTestId('update-error-toast');
            expect(toast).toHaveTextContent(/network down/i);
            // The old persistent banner must not appear.
            expect(screen.queryByTestId('update-banner-error')).toBeNull();
        } finally {
            vi.mocked(check).mockReset();
            vi.mocked(check).mockImplementation(async () => null);
            vi.useRealTimers();
        }
    });
});
