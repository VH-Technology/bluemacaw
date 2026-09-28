import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
    listApiKeys: vi.fn(),
    getTranscriptCleanupApiKeyId: vi.fn(),
    setTranscriptCleanupApiKeyId: vi.fn(),
}));

import * as db from '@/lib/db';
import { SettingsCleanup } from './SettingsCleanup';

const personalKey = {
    id: 'openai-personal',
    providerId: 'openai',
    nickname: 'Personal',
    createdAt: '2026-05-09',
};

const openaiKeys = [
    personalKey,
    {
        id: 'groq-work',
        providerId: 'groq',
        nickname: 'Work',
        createdAt: '2026-05-10',
    },
];

beforeEach(() => {
    vi.mocked(db.listApiKeys).mockReset().mockResolvedValue(openaiKeys);
    vi.mocked(db.getTranscriptCleanupApiKeyId).mockReset().mockResolvedValue(null);
    vi.mocked(db.setTranscriptCleanupApiKeyId).mockReset().mockResolvedValue(undefined);
});

describe('<SettingsCleanup />', () => {
    it('shows the privacy disclosure and only OpenAI keys', async () => {
        render(<SettingsCleanup />);

        expect(screen.getByText(/sends each completed transcript to OpenAI/i)).toBeInTheDocument();
        const select = await screen.findByLabelText(/OpenAI API key/i);
        expect(select).toHaveTextContent('Personal');
        expect(select).not.toHaveTextContent('Work');
    });

    it('loads the enabled state and selected key', async () => {
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValueOnce('openai-personal');
        render(<SettingsCleanup />);

        const toggle = screen.getByLabelText(/enable text cleanup/i);
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
        expect(screen.getByLabelText(/OpenAI API key/i)).toHaveValue('openai-personal');
    });

    it('enables cleanup with the selected OpenAI key', async () => {
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const select = await screen.findByLabelText(/OpenAI API key/i);
        const toggle = screen.getByLabelText(/enable text cleanup/i);
        expect(toggle).toBeDisabled();

        await user.selectOptions(select, 'openai-personal');
        expect(toggle).not.toBeDisabled();

        await user.click(toggle);

        await waitFor(() => {
            expect(db.setTranscriptCleanupApiKeyId).toHaveBeenCalledWith('openai-personal');
            expect(toggle).toHaveAttribute('aria-checked', 'true');
        });
    });

    it('persists key changes while enabled', async () => {
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([
            personalKey,
            {
                id: 'openai-work',
                providerId: 'openai',
                nickname: 'OpenAI Work',
                createdAt: '2026-05-11',
            },
        ]);
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValueOnce('openai-personal');
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const select = await screen.findByLabelText(/OpenAI API key/i);

        await user.selectOptions(select, 'openai-work');

        expect(db.setTranscriptCleanupApiKeyId).toHaveBeenCalledWith('openai-work');
    });

    it('disables cleanup by clearing the persisted key', async () => {
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValueOnce('openai-personal');
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const toggle = screen.getByLabelText(/enable text cleanup/i);
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));

        await user.click(toggle);

        expect(db.setTranscriptCleanupApiKeyId).toHaveBeenCalledWith(null);
    });

    it('keeps cleanup enabled and shows an error when disabling cannot be persisted', async () => {
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValueOnce('openai-personal');
        vi.mocked(db.setTranscriptCleanupApiKeyId).mockRejectedValueOnce(
            new Error('database busy'),
        );
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const toggle = screen.getByLabelText(/enable text cleanup/i);
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));

        await user.click(toggle);

        await waitFor(() => {
            expect(toggle).toHaveAttribute('aria-checked', 'true');
            expect(screen.getByRole('alert')).toHaveTextContent(/database busy/i);
        });
    });

    it('cannot be enabled until an OpenAI key exists', async () => {
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([]);
        render(<SettingsCleanup />);

        expect(await screen.findByText(/add an OpenAI API key first/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/enable text cleanup/i)).toBeDisabled();
    });

    it('reloads available keys when the refresh token changes', async () => {
        const { rerender } = render(<SettingsCleanup refreshToken={0} />);
        const select = await screen.findByLabelText(/OpenAI API key/i);
        expect(select).toHaveValue('');
        expect(select).toHaveTextContent('Personal');
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([]);
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValueOnce(null);

        rerender(<SettingsCleanup refreshToken={1} />);

        expect(await screen.findByText(/add an OpenAI API key first/i)).toBeInTheDocument();
    });
});
