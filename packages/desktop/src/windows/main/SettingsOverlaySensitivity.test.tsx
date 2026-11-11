import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
    getOverlaySensitivity: vi.fn(async () => 1),
    setOverlaySensitivity: vi.fn(async (_value: number) => undefined),
}));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn(async () => undefined) }));

import { getOverlaySensitivity, setOverlaySensitivity } from '@/lib/db';
import { emit } from '@tauri-apps/api/event';
import { SettingsOverlaySensitivity } from './SettingsOverlaySensitivity';

beforeEach(() => {
    vi.mocked(getOverlaySensitivity).mockReset().mockResolvedValue(1);
    vi.mocked(setOverlaySensitivity).mockReset().mockResolvedValue(undefined);
    vi.mocked(emit).mockClear();
});

describe('overlay sensitivity setting', () => {
    it('loads the preference, saves changes, and notifies the overlay', async () => {
        vi.mocked(getOverlaySensitivity).mockResolvedValue(0.5);
        render(<SettingsOverlaySensitivity />);
        const slider = screen.getByRole('slider', { name: /sensitivity/i });
        await waitFor(() => expect(slider).toHaveValue('50'));
        fireEvent.change(slider, { target: { value: '30' } });
        await waitFor(() => expect(setOverlaySensitivity).toHaveBeenCalledWith(0.3));
        expect(screen.getByText('30%')).toBeInTheDocument();
        await waitFor(() =>
            expect(emit).toHaveBeenCalledWith('bluemacaw://overlay-sensitivity-changed'),
        );
    });

    it('restores the saved value and reports a failed save', async () => {
        vi.mocked(setOverlaySensitivity).mockRejectedValueOnce(new Error('disk full'));
        render(<SettingsOverlaySensitivity />);
        const slider = screen.getByRole('slider', { name: /sensitivity/i });
        await waitFor(() => expect(slider).not.toBeDisabled());
        fireEvent.change(slider, { target: { value: '20' } });
        expect(await screen.findByRole('alert')).toHaveTextContent(/save/i);
        expect(slider).toHaveValue('100');
        expect(emit).not.toHaveBeenCalled();
    });

    it('serializes rapid changes so the final value is the one persisted', async () => {
        let finishSave!: () => void;
        vi.mocked(setOverlaySensitivity).mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishSave = resolve;
                }),
        );
        render(<SettingsOverlaySensitivity />);
        const slider = screen.getByRole('slider', { name: /sensitivity/i });
        await waitFor(() => expect(slider).not.toBeDisabled());
        fireEvent.change(slider, { target: { value: '50' } });
        await waitFor(() => expect(setOverlaySensitivity).toHaveBeenCalledTimes(1));
        fireEvent.change(slider, { target: { value: '20' } });
        expect(setOverlaySensitivity).toHaveBeenCalledTimes(1);
        finishSave();
        await waitFor(() => expect(setOverlaySensitivity).toHaveBeenLastCalledWith(0.2));
        expect(slider).toHaveValue('20');
    });
});
