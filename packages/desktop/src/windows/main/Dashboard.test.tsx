import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';

vi.mock('@/lib/db', () => ({
    getHistoryStats: vi.fn(),
}));

import { getHistoryStats } from '@/lib/db';

beforeEach(() => {
    vi.mocked(getHistoryStats).mockResolvedValue({
        totalWords: 1234,
        streakDays: 5,
        avgWPM: 42.5,
        timeSavedMinutes: 12.3,
        topProvider: 'openai',
        estCostUSD: 0.42,
        projectedMonthlyUSD: 3.5,
    });
});

describe('Dashboard', () => {
    it('renders the stat cards from getHistoryStats, including a cost forecast', async () => {
        render(<Dashboard />);
        await waitFor(() => expect(screen.getByText('1,234')).toBeInTheDocument());
        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByText(/42\.5/)).toBeInTheDocument();
        expect(screen.getByText(/12\.3/)).toBeInTheDocument();
        expect(screen.getByText('openai')).toBeInTheDocument();
        // Projected monthly spend, formatted as currency.
        expect(screen.getByText('$3.50')).toBeInTheDocument();
    });

    it('shows a — for the cost forecast when there is no priced usage', async () => {
        vi.mocked(getHistoryStats).mockResolvedValueOnce({
            totalWords: 10,
            streakDays: 1,
            avgWPM: 30,
            timeSavedMinutes: 0,
            topProvider: 'local',
            estCostUSD: 0,
            projectedMonthlyUSD: null,
        });
        render(<Dashboard />);
        await waitFor(() => expect(screen.getByText('10')).toBeInTheDocument());
        expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('renders — placeholders when stats are null', async () => {
        vi.mocked(getHistoryStats).mockResolvedValueOnce({
            totalWords: 0,
            streakDays: 0,
            avgWPM: null,
            timeSavedMinutes: 0,
            topProvider: null,
            estCostUSD: 0,
            projectedMonthlyUSD: null,
        });
        render(<Dashboard />);
        await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0));
    });
});
