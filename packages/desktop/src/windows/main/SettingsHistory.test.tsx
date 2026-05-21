import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsHistory } from './SettingsHistory';

vi.mock('@/lib/db', () => ({
    getRetentionDays: vi.fn(),
    setRetentionDays: vi.fn(),
    purgeOlderThan: vi.fn(),
    clearAllTranscriptions: vi.fn(),
}));

import {
    clearAllTranscriptions,
    getRetentionDays,
    purgeOlderThan,
    setRetentionDays,
} from '@/lib/db';

beforeEach(() => {
    vi.mocked(getRetentionDays).mockResolvedValue(365);
    vi.mocked(setRetentionDays).mockResolvedValue();
    vi.mocked(purgeOlderThan).mockResolvedValue({ softDeleted: 0, hardDeleted: 0 });
    vi.mocked(clearAllTranscriptions).mockResolvedValue({ deleted: 0 });
});

describe('SettingsHistory', () => {
    it('loads + renders the persisted retention value', async () => {
        vi.mocked(getRetentionDays).mockResolvedValueOnce(90);
        render(<SettingsHistory />);
        await waitFor(() => {
            const select = screen.getByLabelText(/retain/i) as HTMLSelectElement;
            expect(select.value).toBe('90');
        });
    });

    it('persists + sweeps when changing retention', async () => {
        render(<SettingsHistory />);
        await waitFor(() => screen.getByLabelText(/retain/i));
        fireEvent.change(screen.getByLabelText(/retain/i), { target: { value: '30' } });
        await waitFor(() => {
            expect(setRetentionDays).toHaveBeenCalledWith(30);
            expect(purgeOlderThan).toHaveBeenCalledWith(30);
        });
    });

    it('Clear all opens a confirmation, only clears on confirm', async () => {
        render(<SettingsHistory />);
        fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
        expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
        // cancel does NOT clear
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(clearAllTranscriptions).not.toHaveBeenCalled();
        // confirm DOES clear
        fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
        await waitFor(() => expect(clearAllTranscriptions).toHaveBeenCalled());
    });

    it('fires onHistoryChanged after Clear all so the parent can refresh', async () => {
        const onHistoryChanged = vi.fn();
        render(<SettingsHistory onHistoryChanged={onHistoryChanged} />);
        fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
        fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
        await waitFor(() => expect(onHistoryChanged).toHaveBeenCalledTimes(1));
    });

    it('fires onHistoryChanged after a retention purge that deleted rows', async () => {
        vi.mocked(purgeOlderThan).mockResolvedValueOnce({ softDeleted: 2, hardDeleted: 0 });
        const onHistoryChanged = vi.fn();
        render(<SettingsHistory onHistoryChanged={onHistoryChanged} />);
        await waitFor(() => screen.getByLabelText(/retain/i));
        fireEvent.change(screen.getByLabelText(/retain/i), { target: { value: '30' } });
        await waitFor(() => expect(onHistoryChanged).toHaveBeenCalledTimes(1));
    });

    it('does NOT fire onHistoryChanged when a retention purge deleted nothing', async () => {
        const onHistoryChanged = vi.fn();
        render(<SettingsHistory onHistoryChanged={onHistoryChanged} />);
        await waitFor(() => screen.getByLabelText(/retain/i));
        fireEvent.change(screen.getByLabelText(/retain/i), { target: { value: '30' } });
        await waitFor(() => expect(purgeOlderThan).toHaveBeenCalled());
        expect(onHistoryChanged).not.toHaveBeenCalled();
    });
});
