import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/invoke', () => ({
    vox: {
        getPlatformInfo: vi.fn(),
        checkMicrophonePermission: vi.fn(),
        checkAccessibilityPermission: vi.fn(),
        checkAccessibilityPermissionPrompting: vi.fn(),
        checkInputMonitoringPermission: vi.fn(),
        requestMicrophonePermission: vi.fn(),
        requestAccessibilityPermission: vi.fn(),
        requestInputMonitoringPermission: vi.fn(),
        openSettingsPanel: vi.fn(),
        restartApp: vi.fn(),
    },
}));

vi.mock('@/lib/onboarding', () => ({
    markOnboardingCompleted: vi.fn(async () => undefined),
}));

import { vox } from '@/lib/invoke';
import { markOnboardingCompleted } from '@/lib/onboarding';
import { OnboardingScreen } from './OnboardingScreen';

function resetAllMocks() {
    vi.mocked(vox.getPlatformInfo).mockReset();
    vi.mocked(vox.checkMicrophonePermission).mockReset();
    vi.mocked(vox.checkAccessibilityPermission).mockReset();
    vi.mocked(vox.checkAccessibilityPermissionPrompting).mockReset();
    vi.mocked(vox.checkInputMonitoringPermission).mockReset();
    vi.mocked(vox.requestMicrophonePermission).mockReset();
    vi.mocked(vox.requestAccessibilityPermission).mockReset();
    vi.mocked(vox.requestInputMonitoringPermission).mockReset();
    vi.mocked(vox.openSettingsPanel).mockReset();
    vi.mocked(vox.restartApp).mockReset();
    vi.mocked(markOnboardingCompleted).mockReset();
    vi.mocked(markOnboardingCompleted).mockResolvedValue(undefined);
}

beforeEach(() => {
    resetAllMocks();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('<OnboardingScreen />', () => {
    it('macOS: shows three permission rows and Continue is disabled until all granted', async () => {
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'macos', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');
        vi.mocked(vox.checkAccessibilityPermission).mockResolvedValue('Denied');
        vi.mocked(vox.checkInputMonitoringPermission).mockResolvedValue('Granted');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-row-microphone')).toBeInTheDocument());
        expect(screen.getByTestId('perm-row-accessibility')).toBeInTheDocument();
        expect(screen.getByTestId('perm-row-input-monitoring')).toBeInTheDocument();
        expect(screen.getByTestId('perm-continue')).toBeDisabled();
    });

    it('Windows: shows only the microphone row and Continue enables when granted', async () => {
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'windows', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-row-microphone')).toBeInTheDocument());
        expect(screen.queryByTestId('perm-row-accessibility')).toBeNull();
        expect(screen.queryByTestId('perm-row-input-monitoring')).toBeNull();
        await waitFor(() => expect(screen.getByTestId('perm-continue')).toBeEnabled());
    });

    it('Linux non-Wayland: shows only the microphone row and no Wayland banner', async () => {
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'linux', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-row-microphone')).toBeInTheDocument());
        expect(screen.queryByTestId('perm-row-accessibility')).toBeNull();
        expect(screen.queryByTestId('wayland-banner')).toBeNull();
    });

    it('Linux Wayland: shows the microphone row plus the Wayland info banner', async () => {
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'linux', isWayland: true });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-row-microphone')).toBeInTheDocument());
        expect(screen.getByTestId('wayland-banner')).toBeInTheDocument();
    });

    it('Skip flow: opens confirm dialog, confirm marks completion and calls onComplete', async () => {
        const user = userEvent.setup();
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'windows', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Denied');
        const onComplete = vi.fn();

        render(<OnboardingScreen onComplete={onComplete} />);

        await waitFor(() => expect(screen.getByTestId('perm-skip')).toBeInTheDocument());
        await user.click(screen.getByTestId('perm-skip'));
        expect(screen.getByTestId('skip-confirm-dialog')).toBeInTheDocument();

        await user.click(screen.getByTestId('skip-confirm'));
        await waitFor(() => expect(markOnboardingCompleted).toHaveBeenCalledTimes(1));
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('Grant button calls the matching request command per row (Windows microphone)', async () => {
        const user = userEvent.setup();
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'windows', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Denied');
        vi.mocked(vox.requestMicrophonePermission).mockResolvedValue('Granted');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() =>
            expect(screen.getByTestId('perm-grant-microphone')).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId('perm-grant-microphone'));
        expect(vox.requestMicrophonePermission).toHaveBeenCalled();
    });

    it('macOS Accessibility grant: tries the prompting check first, falls back to deep-link', async () => {
        const user = userEvent.setup();
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'macos', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');
        vi.mocked(vox.checkAccessibilityPermission).mockResolvedValue('Denied');
        vi.mocked(vox.checkInputMonitoringPermission).mockResolvedValue('Granted');
        vi.mocked(vox.checkAccessibilityPermissionPrompting).mockResolvedValue('Denied');
        vi.mocked(vox.openSettingsPanel).mockResolvedValue(undefined);

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() =>
            expect(screen.getByTestId('perm-grant-accessibility')).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId('perm-grant-accessibility'));
        expect(vox.checkAccessibilityPermissionPrompting).toHaveBeenCalled();
        await waitFor(() => expect(vox.openSettingsPanel).toHaveBeenCalledWith('accessibility'));
    });

    it('macOS: clicking Grant on Accessibility surfaces the restart banner immediately', async () => {
        const user = userEvent.setup();
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'macos', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');
        // AX stays Denied throughout — the running process can't observe its
        // own TCC grant on macOS, which is exactly what the immediate banner
        // is for.
        vi.mocked(vox.checkAccessibilityPermission).mockResolvedValue('Denied');
        vi.mocked(vox.checkInputMonitoringPermission).mockResolvedValue('Granted');
        vi.mocked(vox.checkAccessibilityPermissionPrompting).mockResolvedValue('Denied');
        vi.mocked(vox.openSettingsPanel).mockResolvedValue(undefined);

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() =>
            expect(screen.getByTestId('perm-grant-accessibility')).toBeInTheDocument(),
        );
        expect(screen.queryByTestId('restart-banner')).toBeNull();
        await user.click(screen.getByTestId('perm-grant-accessibility'));
        await waitFor(() => expect(screen.getByTestId('restart-banner')).toBeInTheDocument());
    });

    it('macOS: clicking Grant on Input Monitoring surfaces the restart banner immediately', async () => {
        const user = userEvent.setup();
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'macos', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');
        vi.mocked(vox.checkAccessibilityPermission).mockResolvedValue('Granted');
        vi.mocked(vox.checkInputMonitoringPermission).mockResolvedValue('Denied');
        vi.mocked(vox.requestInputMonitoringPermission).mockResolvedValue('Denied');
        vi.mocked(vox.openSettingsPanel).mockResolvedValue(undefined);

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() =>
            expect(screen.getByTestId('perm-grant-input-monitoring')).toBeInTheDocument(),
        );
        expect(screen.queryByTestId('restart-banner')).toBeNull();
        await user.click(screen.getByTestId('perm-grant-input-monitoring'));
        await waitFor(() => expect(screen.getByTestId('restart-banner')).toBeInTheDocument());
    });

    it('Windows: clicking Grant on Microphone does NOT surface a restart banner', async () => {
        const user = userEvent.setup();
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'windows', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Denied');
        vi.mocked(vox.requestMicrophonePermission).mockResolvedValue('Denied');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() =>
            expect(screen.getByTestId('perm-grant-microphone')).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId('perm-grant-microphone'));
        // Give the click handler time to settle; the banner should never appear.
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.queryByTestId('restart-banner')).toBeNull();
    });

    it('Restart banner only appears after Accessibility transitions Denied → Granted', async () => {
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'macos', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');
        vi.mocked(vox.checkInputMonitoringPermission).mockResolvedValue('Granted');
        // Stay Denied until we explicitly flip the mock — the poller would
        // otherwise race us and flip the banner before our "no banner yet"
        // assertion gets to run.
        const ax = vi.mocked(vox.checkAccessibilityPermission);
        ax.mockResolvedValue('Denied');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() =>
            expect(screen.getByTestId('perm-status-accessibility').textContent).toMatch(
                /not granted/i,
            ),
        );
        expect(screen.queryByTestId('restart-banner')).toBeNull();

        // Flip the mock; the next poll tick will observe Granted and the
        // hook will surface the restart CTA.
        ax.mockResolvedValue('Granted');
        await waitFor(() => expect(screen.getByTestId('restart-banner')).toBeInTheDocument(), {
            timeout: 3000,
        });
    });
});
