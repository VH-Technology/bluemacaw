import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { History, type HistoryEntry } from './History';

const entries: HistoryEntry[] = [
    {
        id: '1',
        text: 'Hello world',
        provider: 'OpenAI',
        model: 'whisper-1',
        createdAt: '2026-05-01T10:00:00Z',
        durationMs: 4500,
        wordCount: 2,
    },
    {
        id: '2',
        text: 'Another entry',
        provider: 'Groq',
        model: 'whisper-large-v3',
        createdAt: '2026-05-02T10:00:00Z',
        durationMs: 3000,
        wordCount: 2,
    },
    {
        id: '3',
        text: 'Goodbye moon',
        provider: 'OpenAI',
        model: 'whisper-1',
        createdAt: '2026-05-03T10:00:00Z',
        durationMs: 2000,
        wordCount: 2,
    },
];

describe('<History />', () => {
    it('renders a row per entry by default', () => {
        render(<History entries={entries} pageSize={10} />);
        expect(screen.getAllByTestId('history-row')).toHaveLength(3);
    });

    it('renders an empty-state message when there are no entries', () => {
        render(<History entries={[]} pageSize={10} />);
        expect(screen.getByText(/no transcriptions yet/i)).toBeInTheDocument();
    });

    it('filters by search term across the text field', async () => {
        const user = userEvent.setup();
        render(<History entries={entries} pageSize={10} />);
        await user.type(screen.getByPlaceholderText(/search/i), 'Goodbye');
        const rows = screen.getAllByTestId('history-row');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveTextContent(/Goodbye moon/);
    });

    it('filters by provider when a provider is chosen', async () => {
        const user = userEvent.setup();
        render(<History entries={entries} pageSize={10} />);
        await user.selectOptions(screen.getByLabelText(/provider/i), 'Groq');
        const rows = screen.getAllByTestId('history-row');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveTextContent(/Another entry/);
    });

    it('paginates when entries exceed the page size', async () => {
        const user = userEvent.setup();
        render(<History entries={entries} pageSize={2} />);
        expect(screen.getAllByTestId('history-row')).toHaveLength(2);
        await user.click(screen.getByRole('button', { name: /next/i }));
        expect(screen.getAllByTestId('history-row')).toHaveLength(1);
    });

    it('collapses long transcription text by default', () => {
        const longText = `${'Long transcription text. '.repeat(20)}Final sentence.`;
        render(<History entries={[makeEntry({ text: longText })]} pageSize={10} />);
        const toggle = screen.getByTestId('history-text-toggle-1');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle.textContent?.trim().endsWith('…')).toBe(true);
        expect(toggle).not.toHaveTextContent('Final sentence.');
    });

    it('expands long transcription text when clicked', async () => {
        const user = userEvent.setup();
        const longText = `${'Long transcription text. '.repeat(20)}Final sentence.`;
        render(<History entries={[makeEntry({ text: longText })]} pageSize={10} />);
        const toggle = screen.getByTestId('history-text-toggle-1');
        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(toggle).toHaveTextContent('Final sentence.');
    });
});

function makeEntry(over: Partial<HistoryEntry> = {}): HistoryEntry {
    return {
        id: '1',
        text: 'Hello world.',
        provider: 'openai',
        model: 'whisper-1',
        createdAt: '2026-05-09T10:00:00Z',
        durationMs: 4500,
        wordCount: 2,
        ...over,
    };
}

describe('History row actions', () => {
    it('renders Copy, Export, Delete buttons per row', () => {
        render(<History entries={[makeEntry()]} onDelete={vi.fn()} />);
        expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /export/i }).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    });

    it('Delete fires onDelete with the row id', () => {
        const onDelete = vi.fn();
        render(<History entries={[makeEntry()]} onDelete={onDelete} />);
        fireEvent.click(screen.getByRole('button', { name: /delete/i }));
        expect(onDelete).toHaveBeenCalledWith('1');
    });

    it('Copy writes the text to the clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            configurable: true,
        });
        render(<History entries={[makeEntry()]} onDelete={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /copy/i }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('Hello world.'));
    });
});
