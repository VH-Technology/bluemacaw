import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
    getDeepgramSmartFormatEnabled: vi.fn(),
    setDeepgramSmartFormatEnabled: vi.fn(),
}));

import * as db from '@/lib/db';
import { SettingsDeepgramFormatting } from './SettingsDeepgramFormatting';

beforeEach(() => {
    vi.mocked(db.getDeepgramSmartFormatEnabled).mockReset().mockResolvedValue(true);
    vi.mocked(db.setDeepgramSmartFormatEnabled).mockReset().mockResolvedValue(undefined);
});

function toggle() {
    return screen.getByLabelText(/deepgram punctuation and formatting/i);
}

describe('<SettingsDeepgramFormatting />', () => {
    it('shows the saved setting once it has loaded', async () => {
        vi.mocked(db.getDeepgramSmartFormatEnabled).mockResolvedValue(false);
        render(<SettingsDeepgramFormatting />);

        await waitFor(() => expect(toggle()).toBeEnabled());
        expect(toggle()).toHaveAttribute('aria-checked', 'false');
    });

    it('saves the new value when switched off', async () => {
        const user = userEvent.setup();
        render(<SettingsDeepgramFormatting />);
        await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'));

        await user.click(toggle());

        expect(db.setDeepgramSmartFormatEnabled).toHaveBeenCalledWith(false);
        await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'false'));
    });

    it('goes back to the saved value and says why when saving fails', async () => {
        vi.mocked(db.setDeepgramSmartFormatEnabled).mockRejectedValue(new Error('database busy'));
        const user = userEvent.setup();
        render(<SettingsDeepgramFormatting />);
        await waitFor(() => expect(toggle()).toBeEnabled());

        await user.click(toggle());

        expect(await screen.findByRole('alert')).toHaveTextContent(/database busy/i);
        expect(toggle()).toHaveAttribute('aria-checked', 'true');
    });
});
