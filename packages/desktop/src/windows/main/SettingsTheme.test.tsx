import { render, screen } from '@testing-library/react';
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

import { SettingsTheme } from './SettingsTheme';

beforeEach(() => {
    setPreference.mockClear();
});

describe('<SettingsTheme />', () => {
    it('renders theme radio options', () => {
        render(<SettingsTheme />);
        expect(screen.getByLabelText(/light/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/dark/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/system/i)).toBeInTheDocument();
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
        await user.click(screen.getByLabelText(/dark/i));
        expect(setPreference).toHaveBeenCalledWith('dark');
    });
});
