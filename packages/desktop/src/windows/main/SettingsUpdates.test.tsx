import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsUpdates } from './SettingsUpdates';

describe('<SettingsUpdates />', () => {
    it('renders an auto-update toggle and check-now button', () => {
        render(<SettingsUpdates />);
        expect(screen.getByLabelText(/auto-update/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /check now/i })).toBeInTheDocument();
    });

    it('invokes onCheckNow when the button is clicked', async () => {
        const onCheckNow = vi.fn();
        const user = userEvent.setup();
        render(<SettingsUpdates onCheckNow={onCheckNow} />);
        await user.click(screen.getByRole('button', { name: /check now/i }));
        expect(onCheckNow).toHaveBeenCalledTimes(1);
    });

    it('disables the button and shows "Checking…" while a check is in flight', () => {
        render(<SettingsUpdates status={{ kind: 'checking' }} />);
        const btn = screen.getByRole('button', { name: /checking/i });
        expect(btn).toBeDisabled();
    });

    it('renders an available version in the status line', () => {
        render(<SettingsUpdates status={{ kind: 'available', version: '0.2.0' }} />);
        expect(screen.getByTestId('updates-status-line')).toHaveTextContent(
            /update 0\.2\.0 is ready to install/i,
        );
    });

    it('renders an error message in the status line', () => {
        render(<SettingsUpdates status={{ kind: 'error', message: 'manifest 404' }} />);
        expect(screen.getByTestId('updates-status-line')).toHaveTextContent(/manifest 404/i);
    });

    it('replaces Check now with Install & restart when an update is available', () => {
        render(<SettingsUpdates status={{ kind: 'available', version: '0.2.0' }} />);
        expect(screen.getByRole('button', { name: /install & restart/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /check now/i })).toBeNull();
    });

    it('confirms before installing: clicking Install & restart opens a dialog, Confirm calls onInstall', async () => {
        const onInstall = vi.fn();
        const user = userEvent.setup();
        render(
            <SettingsUpdates
                status={{ kind: 'available', version: '0.2.0' }}
                onInstall={onInstall}
            />,
        );
        // Click the card button — should NOT install yet, just open the confirm.
        await user.click(screen.getByRole('button', { name: /install & restart/i }));
        expect(onInstall).not.toHaveBeenCalled();
        const dialog = screen.getByTestId('update-confirm');
        expect(dialog).toHaveTextContent(/install update 0\.2\.0\?/i);
        // Confirm inside the dialog.
        await user.click(within(dialog).getByRole('button', { name: /install & restart/i }));
        expect(onInstall).toHaveBeenCalledTimes(1);
    });

    it('cancelling the confirm dialog does not install', async () => {
        const onInstall = vi.fn();
        const user = userEvent.setup();
        render(
            <SettingsUpdates
                status={{ kind: 'available', version: '0.2.0' }}
                onInstall={onInstall}
            />,
        );
        await user.click(screen.getByRole('button', { name: /install & restart/i }));
        await user.click(
            within(screen.getByTestId('update-confirm')).getByRole('button', { name: /cancel/i }),
        );
        expect(onInstall).not.toHaveBeenCalled();
    });

    it('shows a disabled Updating… button while downloading', () => {
        render(<SettingsUpdates status={{ kind: 'downloading', progress: 0.5 }} />);
        const btn = screen.getByRole('button', { name: /updating/i });
        expect(btn).toBeDisabled();
    });
});
