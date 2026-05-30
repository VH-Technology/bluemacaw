import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from './UpdateBanner';

describe('<UpdateBanner />', () => {
    it('renders nothing for idle/checking/up-to-date', () => {
        const onInstall = vi.fn();
        const { rerender } = render(
            <UpdateBanner status={{ kind: 'idle' }} onInstall={onInstall} />,
        );
        expect(screen.queryByRole('status')).toBeNull();
        rerender(<UpdateBanner status={{ kind: 'checking' }} onInstall={onInstall} />);
        expect(screen.queryByRole('status')).toBeNull();
        rerender(<UpdateBanner status={{ kind: 'up-to-date' }} onInstall={onInstall} />);
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('renders the version and triggers onInstall when "available"', async () => {
        const onInstall = vi.fn();
        const user = userEvent.setup();
        render(
            <UpdateBanner status={{ kind: 'available', version: '0.2.0' }} onInstall={onInstall} />,
        );
        expect(screen.getByText(/update 0\.2\.0 available/i)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /install/i }));
        expect(onInstall).toHaveBeenCalledTimes(1);
    });

    it('shows a progress percentage when downloading', () => {
        render(
            <UpdateBanner status={{ kind: 'downloading', progress: 0.42 }} onInstall={vi.fn()} />,
        );
        expect(screen.getByText(/42%/)).toBeInTheDocument();
    });

    it('shows an installing message', () => {
        render(<UpdateBanner status={{ kind: 'installing' }} onInstall={vi.fn()} />);
        expect(screen.getByText(/installing/i)).toBeInTheDocument();
    });

    it('renders nothing for the error state (failures surface as a toast instead)', () => {
        render(
            <UpdateBanner
                status={{ kind: 'error', message: 'signature mismatch' }}
                onInstall={vi.fn()}
            />,
        );
        expect(screen.queryByTestId('update-banner-error')).toBeNull();
        expect(screen.queryByText(/signature mismatch/i)).toBeNull();
    });
});
