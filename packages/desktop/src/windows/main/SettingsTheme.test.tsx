import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setPreference = vi.fn(async () => undefined);

vi.mock('@/lib/use-theme', () => ({
    useTheme: () => ({
        preference: 'system' as const,
        resolved: 'light' as const,
        setPreference,
    }),
}));
vi.mock('@/lib/autostart', () => ({
    autostart: {
        isEnabled: vi.fn(async () => false),
        set: vi.fn(async () => undefined),
    },
}));

import { autostart } from '@/lib/autostart';
import { SettingsTheme } from './SettingsTheme';

beforeEach(() => {
    setPreference.mockClear();
    vi.mocked(autostart.isEnabled).mockReset().mockResolvedValue(false);
    vi.mocked(autostart.set).mockReset().mockResolvedValue(undefined);
});

describe('<SettingsTheme />', () => {
    it('renders theme card options', () => {
        render(<SettingsTheme />);
        expect(screen.getByRole('button', { name: /light/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /dark/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /system/i })).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

    it('shows the resolved value while preference is system', () => {
        render(<SettingsTheme />);
        expect(screen.getByTestId('theme-resolved-hint')).toHaveTextContent(
            /currently using: light/i,
        );
    });

    it('calls setPreference when a theme is picked', async () => {
        const user = userEvent.setup();
        render(<SettingsTheme />);
        await user.click(screen.getByRole('button', { name: /dark/i }));
        expect(setPreference).toHaveBeenCalledWith('dark');
    });

    it('reflects the current autostart state on mount', async () => {
        vi.mocked(autostart.isEnabled).mockResolvedValueOnce(true);
        render(<SettingsTheme />);
        await waitFor(() => {
            const toggle = screen.getByTestId('settings-autostart-toggle');
            expect(toggle).toHaveAttribute('data-state', 'checked');
        });
    });

    it('flips autostart through the plugin when the user toggles the switch', async () => {
        render(<SettingsTheme />);
        await waitFor(() => {
            const toggle = screen.getByTestId('settings-autostart-toggle');
            expect(toggle).toHaveAttribute('data-state', 'unchecked');
        });
        const toggle = screen.getByTestId('settings-autostart-toggle');
        fireEvent.click(toggle);
        await waitFor(() => {
            expect(autostart.set).toHaveBeenCalledWith(true);
            expect(toggle).toHaveAttribute('data-state', 'checked');
        });
    });
});
