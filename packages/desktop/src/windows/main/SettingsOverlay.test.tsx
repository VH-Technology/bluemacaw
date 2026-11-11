import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listenMock, fireOff } = vi.hoisted(() => {
    type Handler = (event: { payload: unknown }) => void;
    let offHandler: Handler | null = null;
    return {
        listenMock: vi.fn(async (name: string, h: Handler) => {
            if (name === 'bluemacaw://overlay-position-setup-off') offHandler = h;
            return () => {
                if (name === 'bluemacaw://overlay-position-setup-off') offHandler = null;
            };
        }),
        fireOff: (payload: { reason: 'manual' | 'idle' | 'recording-wins' }) =>
            offHandler?.({ payload }),
    };
});

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

vi.mock('@/lib/db', () => ({
    getOverlayEnabled: vi.fn(async () => true),
    setOverlayEnabled: vi.fn(async () => undefined),
    getOverlaySensitivity: vi.fn(async () => 1),
}));

vi.mock('@/lib/overlay-bridge', () => ({
    OVERLAY_POSITION_SETUP_OFF_EVENT: 'bluemacaw://overlay-position-setup-off',
    hideOverlayWindow: vi.fn(async () => undefined),
    enterOverlayPositionSetup: vi.fn(async () => undefined),
    exitOverlayPositionSetup: vi.fn(async () => undefined),
    resetOverlayPosition: vi.fn(async () => undefined),
}));

import * as db from '@/lib/db';
import * as bridge from '@/lib/overlay-bridge';
import { SettingsOverlay } from './SettingsOverlay';

beforeEach(() => {
    listenMock.mockClear();
    vi.mocked(db.getOverlayEnabled).mockReset().mockResolvedValue(true);
    vi.mocked(db.setOverlayEnabled).mockReset();
    vi.mocked(bridge.hideOverlayWindow).mockReset();
    vi.mocked(bridge.enterOverlayPositionSetup).mockReset().mockResolvedValue(undefined);
    vi.mocked(bridge.exitOverlayPositionSetup).mockReset().mockResolvedValue(undefined);
    vi.mocked(bridge.resetOverlayPosition).mockReset().mockResolvedValue(undefined);
});

describe('<SettingsOverlay />', () => {
    it('renders the overlay enable toggle', async () => {
        render(<SettingsOverlay />);
        expect(screen.getByRole('heading', { name: /overlay/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/enable overlay/i)).toBeInTheDocument();
    });

    it('reflects the loaded value (default true)', async () => {
        vi.mocked(db.getOverlayEnabled).mockResolvedValueOnce(true);
        render(<SettingsOverlay />);
        const toggle = screen.getByLabelText(/enable overlay/i);
        await waitFor(() => {
            expect(toggle).toHaveAttribute('aria-checked', 'true');
            expect(toggle).not.toBeDisabled();
        });
    });

    it('renders unchecked when stored value is false', async () => {
        vi.mocked(db.getOverlayEnabled).mockResolvedValueOnce(false);
        render(<SettingsOverlay />);
        const toggle = screen.getByLabelText(/enable overlay/i);
        await waitFor(() => {
            expect(toggle).toHaveAttribute('aria-checked', 'false');
        });
    });

    it('persists and hides overlay when toggled off', async () => {
        vi.mocked(db.getOverlayEnabled).mockResolvedValueOnce(true);
        const user = userEvent.setup();
        render(<SettingsOverlay />);
        const toggle = screen.getByLabelText(/enable overlay/i);
        await waitFor(() => expect(toggle).not.toBeDisabled());
        await user.click(toggle);
        await waitFor(() => {
            expect(db.setOverlayEnabled).toHaveBeenCalledWith(false);
            expect(bridge.hideOverlayWindow).toHaveBeenCalled();
        });
    });

    it('persists when toggled on without calling hideOverlayWindow', async () => {
        vi.mocked(db.getOverlayEnabled).mockResolvedValueOnce(false);
        const user = userEvent.setup();
        render(<SettingsOverlay />);
        const toggle = screen.getByLabelText(/enable overlay/i);
        await waitFor(() => expect(toggle).not.toBeDisabled());
        await user.click(toggle);
        await waitFor(() => {
            expect(db.setOverlayEnabled).toHaveBeenCalledWith(true);
        });
        expect(bridge.hideOverlayWindow).not.toHaveBeenCalled();
    });

    it('renders Reset position and Position overlay buttons', () => {
        render(<SettingsOverlay />);
        expect(screen.getByTestId('reset-overlay-position')).toBeInTheDocument();
        const toggle = screen.getByTestId('toggle-overlay-positioning');
        expect(toggle).toHaveTextContent(/position overlay/i);
    });

    it('Reset position button calls resetOverlayPosition', async () => {
        const user = userEvent.setup();
        render(<SettingsOverlay />);
        await user.click(screen.getByTestId('reset-overlay-position'));
        await waitFor(() => {
            expect(bridge.resetOverlayPosition).toHaveBeenCalled();
        });
    });

    it('Position overlay button enters setup and toggles label to Use this position', async () => {
        const user = userEvent.setup();
        render(<SettingsOverlay />);
        const toggle = screen.getByTestId('toggle-overlay-positioning');
        await user.click(toggle);
        await waitFor(() => {
            expect(bridge.enterOverlayPositionSetup).toHaveBeenCalled();
        });
        expect(toggle).toHaveTextContent(/use this position/i);
    });

    it('Use this position click calls exitOverlayPositionSetup with hide:true and reason:manual', async () => {
        const user = userEvent.setup();
        render(<SettingsOverlay />);
        const toggle = screen.getByTestId('toggle-overlay-positioning');
        await user.click(toggle);
        await waitFor(() => expect(toggle).toHaveTextContent(/use this position/i));
        await user.click(toggle);
        await waitFor(() => {
            expect(bridge.exitOverlayPositionSetup).toHaveBeenCalledWith({
                hide: true,
                reason: 'manual',
            });
        });
        expect(toggle).toHaveTextContent(/position overlay/i);
    });

    it('shows a toast when Reset position is clicked', async () => {
        const user = userEvent.setup();
        render(<SettingsOverlay />);
        await user.click(screen.getByTestId('reset-overlay-position'));
        const toast = await screen.findByTestId('overlay-toast');
        expect(toast).toHaveTextContent(/position reset/i);
    });

    it('shows a toast when an off event arrives with reason "manual"', async () => {
        render(<SettingsOverlay />);
        await waitFor(() => expect(listenMock).toHaveBeenCalled());
        fireOff({ reason: 'manual' });
        const toast = await screen.findByTestId('overlay-toast');
        expect(toast).toHaveTextContent(/position saved/i);
    });

    it('shows a toast when an off event arrives with reason "idle"', async () => {
        render(<SettingsOverlay />);
        await waitFor(() => expect(listenMock).toHaveBeenCalled());
        fireOff({ reason: 'idle' });
        const toast = await screen.findByTestId('overlay-toast');
        expect(toast).toHaveTextContent(/position saved/i);
    });

    it('does NOT show a toast when an off event arrives with reason "recording-wins"', async () => {
        render(<SettingsOverlay />);
        await waitFor(() => expect(listenMock).toHaveBeenCalled());
        fireOff({ reason: 'recording-wins' });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(screen.queryByTestId('overlay-toast')).toBeNull();
    });

    it('does not show a toast when "Position overlay" is first clicked (entering setup)', async () => {
        const user = userEvent.setup();
        render(<SettingsOverlay />);
        const toggle = screen.getByTestId('toggle-overlay-positioning');
        await user.click(toggle);
        await waitFor(() => expect(toggle).toHaveTextContent(/use this position/i));
        expect(screen.queryByTestId('overlay-toast')).toBeNull();
    });

    it('reverts to Position overlay when an external setup-off event arrives', async () => {
        const user = userEvent.setup();
        render(<SettingsOverlay />);
        const toggle = screen.getByTestId('toggle-overlay-positioning');
        await user.click(toggle);
        await waitFor(() => expect(toggle).toHaveTextContent(/use this position/i));
        // Simulate the overlay's idle-timer firing
        await waitFor(() => expect(listenMock).toHaveBeenCalled());
        fireOff({ reason: 'idle' });
        await waitFor(() => {
            expect(toggle).toHaveTextContent(/position overlay/i);
        });
    });
});
