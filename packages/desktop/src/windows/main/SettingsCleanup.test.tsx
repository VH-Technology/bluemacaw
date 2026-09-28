import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
    listApiKeys: vi.fn(),
    getTranscriptCleanupApiKeyId: vi.fn(),
    getTranscriptCleanupOptions: vi.fn(),
    setTranscriptCleanupApiKeyId: vi.fn(),
    setTranscriptCleanupOptions: vi.fn(),
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
    vi.mocked(db.getTranscriptCleanupOptions).mockReset().mockResolvedValue({
        modelId: 'gpt-4o-mini',
        prompt: 'Default cleanup prompt',
    });
    vi.mocked(db.setTranscriptCleanupApiKeyId).mockReset().mockResolvedValue(undefined);
    vi.mocked(db.setTranscriptCleanupOptions).mockReset().mockResolvedValue(undefined);
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

    it('loads reasonable default model and prompt values', async () => {
        render(<SettingsCleanup />);

        expect(await screen.findByLabelText(/OpenAI model/i)).toHaveValue('gpt-4o-mini');
        expect(screen.getByLabelText(/Cleanup prompt/i)).toHaveValue('Default cleanup prompt');
    });

    it('saves a custom model and prompt', async () => {
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const model = await screen.findByLabelText(/OpenAI model/i);
        const prompt = screen.getByLabelText(/Cleanup prompt/i);

        await user.clear(model);
        await user.type(model, 'gpt-4.1-mini');
        await user.clear(prompt);
        await user.type(prompt, 'Only remove verbal fillers.');
        await user.click(screen.getByRole('button', { name: /save cleanup instructions/i }));

        expect(db.setTranscriptCleanupOptions).toHaveBeenCalledWith({
            modelId: 'gpt-4.1-mini',
            prompt: 'Only remove verbal fillers.',
        });
    });

    it('resets the model and prompt to defaults', async () => {
        vi.mocked(db.getTranscriptCleanupOptions).mockResolvedValueOnce({
            modelId: 'custom-model',
            prompt: 'Custom prompt',
        });
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        await screen.findByDisplayValue('custom-model');

        await user.click(screen.getByRole('button', { name: /reset defaults/i }));

        expect(db.setTranscriptCleanupOptions).toHaveBeenCalledWith({
            modelId: 'gpt-4o-mini',
            prompt: expect.stringMatching(/speech-to-text transcripts/i),
        });
        await waitFor(() => {
            expect(screen.getByLabelText(/OpenAI model/i)).toHaveValue('gpt-4o-mini');
            expect((screen.getByLabelText(/Cleanup prompt/i) as HTMLTextAreaElement).value).toMatch(
                /speech-to-text transcripts/i,
            );
        });
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
        const user = userEvent.setup();
        const { rerender } = render(<SettingsCleanup refreshToken={0} />);
        const select = await screen.findByLabelText(/OpenAI API key/i);
        expect(select).toHaveValue('');
        expect(select).toHaveTextContent('Personal');
        await user.clear(screen.getByLabelText(/OpenAI model/i));
        await user.type(screen.getByLabelText(/OpenAI model/i), 'unsaved-model');
        await user.clear(screen.getByLabelText(/Cleanup prompt/i));
        await user.type(screen.getByLabelText(/Cleanup prompt/i), 'Unsaved prompt');
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([]);
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValueOnce(null);

        rerender(<SettingsCleanup refreshToken={1} />);

        expect(await screen.findByText(/add an OpenAI API key first/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/OpenAI model/i)).toHaveValue('unsaved-model');
        expect(screen.getByLabelText(/Cleanup prompt/i)).toHaveValue('Unsaved prompt');
    });

    it('shows an error when cleanup settings cannot be loaded', async () => {
        vi.mocked(db.getTranscriptCleanupOptions).mockRejectedValueOnce(new Error('database busy'));

        render(<SettingsCleanup />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            /could not load.*database busy/i,
        );
    });

    it('clears an API-key load error after a successful refresh', async () => {
        vi.mocked(db.listApiKeys).mockRejectedValueOnce(new Error('database busy'));
        const { rerender } = render(<SettingsCleanup refreshToken={0} />);
        expect(await screen.findByRole('alert')).toHaveTextContent(/database busy/i);
        vi.mocked(db.listApiKeys).mockResolvedValueOnce(openaiKeys);

        rerender(<SettingsCleanup refreshToken={1} />);

        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('clears an options-load error after successfully saving options', async () => {
        vi.mocked(db.getTranscriptCleanupOptions).mockRejectedValueOnce(new Error('database busy'));
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        expect(await screen.findByRole('alert')).toHaveTextContent(/database busy/i);
        const model = screen.getByLabelText(/OpenAI model/i);
        await user.clear(model);
        await user.type(model, 'gpt-4.1-mini');

        await user.click(screen.getByRole('button', { name: /save cleanup instructions/i }));

        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
});
