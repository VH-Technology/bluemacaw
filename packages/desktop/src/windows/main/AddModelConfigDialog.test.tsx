import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
    listApiKeys: vi.fn(),
    addModelConfig: vi.fn(),
}));

vi.mock('@/lib/invoke', () => ({
    vox: { getSecret: vi.fn(async () => 'sk-secret') },
}));

const { listModelsSpy, listModelsNoneSpy } = vi.hoisted(() => ({
    listModelsSpy: vi.fn(),
    listModelsNoneSpy: null,
}));

vi.mock('@/providers', () => ({
    PROVIDERS: [
        {
            id: 'openai',
            name: 'OpenAI',
            logoSrc: '',
            docsUrl: '',
            apiKeyHelpUrl: '',
            pricingDocsUrl: '',
            makeModel: () => ({}),
            listModels: listModelsSpy,
            defaultModels: [
                { id: 'whisper-1', displayName: 'Whisper 1', mode: 'batch' },
                { id: 'gpt-4o-transcribe', displayName: 'GPT-4o Transcribe', mode: 'batch' },
            ],
            pricing: {},
        },
        {
            id: 'fal',
            name: 'Fal',
            logoSrc: '',
            docsUrl: '',
            apiKeyHelpUrl: '',
            pricingDocsUrl: '',
            makeModel: () => ({}),
            listModels: listModelsNoneSpy,
            defaultModels: [{ id: 'fal-fast', displayName: 'Fal Fast', mode: 'batch' }],
            pricing: {},
        },
    ],
}));

import * as db from '@/lib/db';
import { AddModelConfigDialog } from './AddModelConfigDialog';

beforeEach(() => {
    vi.mocked(db.listApiKeys).mockReset();
    vi.mocked(db.addModelConfig).mockReset();
    listModelsSpy.mockReset();
});

describe('<AddModelConfigDialog />', () => {
    it('shows the empty message when there are no api keys', async () => {
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([]);
        render(<AddModelConfigDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
        expect(await screen.findByTestId('no-keys-message')).toBeInTheDocument();
    });

    it('lists api keys and shows that providers default models', async () => {
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([
            {
                id: 'key-1',
                providerId: 'openai',
                nickname: 'Personal',
                createdAt: '2026-05-09',
            },
        ]);
        listModelsSpy.mockResolvedValueOnce([]);
        render(<AddModelConfigDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
        const modelSelect = (await screen.findByTestId('model-select')) as HTMLSelectElement;
        const ids = Array.from(modelSelect.options).map((o) => o.value);
        expect(ids).toContain('whisper-1');
        expect(ids).toContain('gpt-4o-transcribe');
    });

    it('replaces the model list with dynamic results when listModels succeeds', async () => {
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([
            {
                id: 'key-1',
                providerId: 'openai',
                nickname: 'Personal',
                createdAt: '2026-05-09',
            },
        ]);
        listModelsSpy.mockResolvedValueOnce([
            { id: 'gpt-4o-mini-transcribe', displayName: 'GPT-4o Mini', mode: 'batch' },
        ]);
        render(<AddModelConfigDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
        await waitFor(() => {
            const modelSelect = screen.getByTestId('model-select') as HTMLSelectElement;
            const ids = Array.from(modelSelect.options).map((o) => o.value);
            expect(ids).toEqual(['gpt-4o-mini-transcribe']);
        });
    });

    it('uses default models when the provider has no listModels', async () => {
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([
            { id: 'key-1', providerId: 'fal', nickname: 'F', createdAt: '2026-05-09' },
        ]);
        render(<AddModelConfigDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
        const modelSelect = (await screen.findByTestId('model-select')) as HTMLSelectElement;
        const ids = Array.from(modelSelect.options).map((o) => o.value);
        expect(ids).toEqual(['fal-fast']);
        expect(listModelsSpy).not.toHaveBeenCalled();
    });

    it('saves the (api_key_id, model_id) pair on click', async () => {
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([
            {
                id: 'key-1',
                providerId: 'openai',
                nickname: 'Personal',
                createdAt: '2026-05-09',
            },
        ]);
        listModelsSpy.mockResolvedValueOnce([]);
        const onAdded = vi.fn();
        const user = userEvent.setup();
        render(<AddModelConfigDialog open onClose={vi.fn()} onAdded={onAdded} />);
        await screen.findByTestId('save-model-config');
        await user.click(screen.getByTestId('save-model-config'));
        await waitFor(() => {
            expect(db.addModelConfig).toHaveBeenCalledWith({
                apiKeyId: 'key-1',
                modelId: 'whisper-1',
            });
            expect(onAdded).toHaveBeenCalled();
        });
    });
});
