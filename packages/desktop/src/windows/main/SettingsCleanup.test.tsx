import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
    listApiKeys: vi.fn(),
    getTranscriptCleanupApiKeyId: vi.fn(),
    getTranscriptCleanupOptions: vi.fn(),
    setTranscriptCleanupApiKeyId: vi.fn(),
    setTranscriptCleanupOptions: vi.fn(),
    getAppleIntelligenceCleanupEnabled: vi.fn(),
    setAppleIntelligenceCleanupEnabled: vi.fn(),
    getAppleIntelligenceCleanupPrompt: vi.fn(),
    setAppleIntelligenceCleanupPrompt: vi.fn(),
    getAppleIntelligenceSplitLongEnabled: vi.fn(),
    setAppleIntelligenceSplitLongEnabled: vi.fn(),
}));

vi.mock('@/lib/invoke', () => ({
    vox: { getAppleIntelligenceStatus: vi.fn() },
}));

import * as db from '@/lib/db';
import { vox } from '@/lib/invoke';
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
    vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockReset().mockResolvedValue(false);
    vi.mocked(db.setAppleIntelligenceCleanupEnabled).mockReset().mockResolvedValue(undefined);
    vi.mocked(db.getAppleIntelligenceCleanupPrompt)
        .mockReset()
        .mockResolvedValue('On-device cleanup prompt');
    vi.mocked(db.setAppleIntelligenceCleanupPrompt).mockReset().mockResolvedValue(undefined);
    vi.mocked(db.getAppleIntelligenceSplitLongEnabled).mockReset().mockResolvedValue(true);
    vi.mocked(db.setAppleIntelligenceSplitLongEnabled).mockReset().mockResolvedValue(undefined);
    // Not macOS 27: the card behaves as the OpenAI-only cleanup it always was.
    vi.mocked(vox.getAppleIntelligenceStatus)
        .mockReset()
        .mockResolvedValue({ status: 'unavailable', reason: 'unsupported-platform' });
});

function onDeviceButton() {
    return screen.getByRole('button', { name: /^on-device/i });
}

function openAiButton() {
    return screen.getByRole('button', { name: /^openai/i });
}

describe('<SettingsCleanup /> with OpenAI', () => {
    it('shows the privacy disclosure and only OpenAI keys', async () => {
        render(<SettingsCleanup />);

        const select = await screen.findByLabelText(/OpenAI API key/i);
        expect(screen.getByText(/sends each completed transcript to OpenAI/i)).toBeInTheDocument();
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

    it('locks the model and prompt while cleanup is off', async () => {
        render(<SettingsCleanup />);

        expect(await screen.findByLabelText(/OpenAI model/i)).toBeDisabled();
        expect(screen.getByLabelText(/Cleanup prompt/i)).toBeDisabled();
        expect(screen.getByRole('button', { name: /reset defaults/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /save cleanup instructions/i })).toBeDisabled();
    });

    it('unlocks the model and prompt once cleanup is enabled', async () => {
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        await user.selectOptions(
            await screen.findByLabelText(/OpenAI API key/i),
            'openai-personal',
        );

        await user.click(screen.getByLabelText(/enable text cleanup/i));

        await waitFor(() => expect(screen.getByLabelText(/Cleanup prompt/i)).toBeEnabled());
        expect(screen.getByLabelText(/OpenAI model/i)).toBeEnabled();
    });

    it('saves a custom model and prompt', async () => {
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValueOnce('openai-personal');
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const model = await screen.findByLabelText(/OpenAI model/i);
        const prompt = screen.getByLabelText(/Cleanup prompt/i);
        await waitFor(() => expect(prompt).toBeEnabled());

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
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValueOnce('openai-personal');
        vi.mocked(db.getTranscriptCleanupOptions).mockResolvedValueOnce({
            modelId: 'custom-model',
            prompt: 'Custom prompt',
        });
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        await screen.findByDisplayValue('custom-model');
        const reset = screen.getByRole('button', { name: /reset defaults/i });
        await waitFor(() => expect(reset).toBeEnabled());

        await user.click(reset);

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
        await waitFor(() => expect(select).toHaveValue('openai-personal'));

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
        await waitFor(() => expect(screen.getByLabelText(/Cleanup prompt/i)).toBeDisabled());
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
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValueOnce('openai-personal');
        const user = userEvent.setup();
        const { rerender } = render(<SettingsCleanup refreshToken={0} />);
        const select = await screen.findByLabelText(/OpenAI API key/i);
        await waitFor(() => expect(select).toHaveValue('openai-personal'));
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
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValueOnce('openai-personal');
        vi.mocked(db.getTranscriptCleanupOptions).mockRejectedValueOnce(new Error('database busy'));
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        expect(await screen.findByRole('alert')).toHaveTextContent(/database busy/i);
        const model = screen.getByLabelText(/OpenAI model/i);
        await waitFor(() => expect(model).toBeEnabled());
        await user.clear(model);
        await user.type(model, 'gpt-4.1-mini');

        await user.click(screen.getByRole('button', { name: /save cleanup instructions/i }));

        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });

    it('does not offer on-device cleanup where Apple Intelligence is out of reach', async () => {
        render(<SettingsCleanup />);
        await screen.findByLabelText(/OpenAI API key/i);

        expect(screen.queryByRole('button', { name: /^on-device/i })).not.toBeInTheDocument();
    });

    it('does not offer the long-dictation switch, which only applies on-device', async () => {
        render(<SettingsCleanup />);
        await screen.findByLabelText(/OpenAI API key/i);

        expect(screen.queryByLabelText(/clean long dictations in parts/i)).not.toBeInTheDocument();
    });
});

describe('<SettingsCleanup /> long-dictation switch', () => {
    beforeEach(() => {
        vi.mocked(vox.getAppleIntelligenceStatus).mockResolvedValue({ status: 'available' });
        vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockResolvedValue(true);
    });

    function splitToggle() {
        return screen.getByLabelText(/clean long dictations in parts/i);
    }

    it('shows the saved setting for the on-device engine', async () => {
        vi.mocked(db.getAppleIntelligenceSplitLongEnabled).mockResolvedValue(false);
        render(<SettingsCleanup />);

        await waitFor(() => expect(splitToggle()).toBeEnabled());
        expect(splitToggle()).toHaveAttribute('aria-checked', 'false');
    });

    it('saves the new value when switched off', async () => {
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        await waitFor(() => expect(splitToggle()).toBeEnabled());
        expect(splitToggle()).toHaveAttribute('aria-checked', 'true');

        await user.click(splitToggle());

        await waitFor(() => expect(splitToggle()).toHaveAttribute('aria-checked', 'false'));
        expect(db.setAppleIntelligenceSplitLongEnabled).toHaveBeenCalledWith(false);
    });

    it('is locked while cleanup is off, like the prompt', async () => {
        vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockResolvedValue(false);
        render(<SettingsCleanup />);
        await waitFor(() => expect(screen.getByLabelText(/enable text cleanup/i)).toBeEnabled());

        expect(splitToggle()).toBeDisabled();
    });

    it('keeps the saved value and reports the error when saving fails', async () => {
        vi.mocked(db.setAppleIntelligenceSplitLongEnabled).mockRejectedValue(
            new Error('database busy'),
        );
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        await waitFor(() => expect(splitToggle()).toBeEnabled());

        await user.click(splitToggle());

        expect(await screen.findByRole('alert')).toHaveTextContent(/database busy/i);
        expect(splitToggle()).toHaveAttribute('aria-checked', 'true');
    });
});

describe('<SettingsCleanup /> with Apple Intelligence', () => {
    beforeEach(() => {
        vi.mocked(vox.getAppleIntelligenceStatus).mockResolvedValue({ status: 'available' });
    });

    it('offers on-device cleanup and picks it by default', async () => {
        render(<SettingsCleanup />);

        await waitFor(() => expect(onDeviceButton()).toHaveAttribute('aria-pressed', 'true'));
        expect(openAiButton()).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByLabelText(/OpenAI API key/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/OpenAI model/i)).not.toBeInTheDocument();
        expect(screen.getByText(/never leave this Mac/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Cleanup prompt/i)).toHaveValue('On-device cleanup prompt');
    });

    it('keeps OpenAI selected for people already using OpenAI cleanup', async () => {
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValueOnce('openai-personal');
        render(<SettingsCleanup />);

        await waitFor(() => expect(openAiButton()).toHaveAttribute('aria-pressed', 'true'));
        expect(screen.getByLabelText(/OpenAI API key/i)).toHaveValue('openai-personal');
    });

    it('enables on-device cleanup and unlocks its prompt', async () => {
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const toggle = screen.getByLabelText(/enable text cleanup/i);
        await waitFor(() => expect(toggle).toBeEnabled());
        expect(screen.getByLabelText(/Cleanup prompt/i)).toBeDisabled();

        await user.click(toggle);

        await waitFor(() => {
            expect(db.setAppleIntelligenceCleanupEnabled).toHaveBeenCalledWith(true);
            expect(toggle).toHaveAttribute('aria-checked', 'true');
            expect(screen.getByLabelText(/Cleanup prompt/i)).toBeEnabled();
        });
    });

    it('disables on-device cleanup and locks its prompt', async () => {
        vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockResolvedValueOnce(true);
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const toggle = screen.getByLabelText(/enable text cleanup/i);
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));

        await user.click(toggle);

        await waitFor(() => {
            expect(db.setAppleIntelligenceCleanupEnabled).toHaveBeenCalledWith(false);
            expect(screen.getByLabelText(/Cleanup prompt/i)).toBeDisabled();
        });
    });

    it('saves the on-device prompt without touching the OpenAI options', async () => {
        vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockResolvedValueOnce(true);
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const prompt = await screen.findByLabelText(/Cleanup prompt/i);
        await waitFor(() => expect(prompt).toBeEnabled());

        await user.clear(prompt);
        await user.type(prompt, 'Fix grammar only.');
        await user.click(screen.getByRole('button', { name: /save cleanup instructions/i }));

        expect(db.setAppleIntelligenceCleanupPrompt).toHaveBeenCalledWith('Fix grammar only.');
        expect(db.setTranscriptCleanupOptions).not.toHaveBeenCalled();
    });

    it('resets the on-device prompt to the grammar and filler default', async () => {
        vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockResolvedValueOnce(true);
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const reset = await screen.findByRole('button', { name: /reset defaults/i });
        await waitFor(() => expect(reset).toBeEnabled());

        await user.click(reset);

        expect(db.setAppleIntelligenceCleanupPrompt).toHaveBeenCalledWith(
            expect.stringMatching(/grammar[\s\S]*filler words/i),
        );
        await waitFor(() =>
            expect((screen.getByLabelText(/Cleanup prompt/i) as HTMLTextAreaElement).value).toMatch(
                /filler words/i,
            ),
        );
    });

    it('moves enabled cleanup to on-device when switching engines', async () => {
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValueOnce('openai-personal');
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const toggle = screen.getByLabelText(/enable text cleanup/i);
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));

        await user.click(onDeviceButton());

        await waitFor(() => {
            expect(db.setAppleIntelligenceCleanupEnabled).toHaveBeenCalledWith(true);
            expect(onDeviceButton()).toHaveAttribute('aria-pressed', 'true');
            expect(toggle).toHaveAttribute('aria-checked', 'true');
        });
    });

    it('turns cleanup off when switching to OpenAI without a key selected', async () => {
        vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockResolvedValueOnce(true);
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const toggle = screen.getByLabelText(/enable text cleanup/i);
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));

        await user.click(openAiButton());

        await waitFor(() => {
            expect(db.setAppleIntelligenceCleanupEnabled).toHaveBeenCalledWith(false);
            expect(openAiButton()).toHaveAttribute('aria-pressed', 'true');
            expect(toggle).toHaveAttribute('aria-checked', 'false');
        });
        expect(screen.getByLabelText(/OpenAI API key/i)).toHaveValue('');
    });

    it('explains how to turn Apple Intelligence on and re-checks on request', async () => {
        vi.mocked(vox.getAppleIntelligenceStatus).mockResolvedValueOnce({
            status: 'unavailable',
            reason: 'apple-intelligence-not-enabled',
        });
        const user = userEvent.setup();
        render(<SettingsCleanup />);

        expect(await screen.findByText(/turn on Apple Intelligence/i)).toBeInTheDocument();
        expect(onDeviceButton()).toHaveAttribute('aria-pressed', 'true');
        const toggle = screen.getByLabelText(/enable text cleanup/i);
        expect(toggle).toBeDisabled();

        await user.click(screen.getByRole('button', { name: /check again/i }));

        await waitFor(() => expect(toggle).toBeEnabled());
        expect(screen.queryByText(/turn on Apple Intelligence/i)).not.toBeInTheDocument();
    });

    it('lets people turn on-device cleanup off after Apple Intelligence becomes unavailable', async () => {
        vi.mocked(vox.getAppleIntelligenceStatus).mockResolvedValueOnce({
            status: 'unavailable',
            reason: 'model-not-ready',
        });
        vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockResolvedValueOnce(true);
        const user = userEvent.setup();
        render(<SettingsCleanup />);
        const toggle = screen.getByLabelText(/enable text cleanup/i);
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
        expect(screen.getByText(/still getting ready/i)).toBeInTheDocument();

        await user.click(toggle);

        expect(db.setAppleIntelligenceCleanupEnabled).toHaveBeenCalledWith(false);
    });

    it('still shows the engines when on-device cleanup is on but this Mac can no longer run it', async () => {
        vi.mocked(vox.getAppleIntelligenceStatus).mockResolvedValueOnce({
            status: 'unavailable',
            reason: 'unsupported-build',
        });
        vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockResolvedValueOnce(true);
        render(<SettingsCleanup />);

        await waitFor(() => expect(onDeviceButton()).toHaveAttribute('aria-pressed', 'true'));
        expect(screen.getByLabelText(/enable text cleanup/i)).toHaveAttribute(
            'aria-checked',
            'true',
        );
    });
});
