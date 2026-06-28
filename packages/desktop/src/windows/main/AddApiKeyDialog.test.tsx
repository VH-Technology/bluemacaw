import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
    addApiKey: vi.fn(),
}));

const { listModelsSpy } = vi.hoisted(() => ({ listModelsSpy: vi.fn() }));

vi.mock('@/providers', () => ({
    PROVIDERS: [
        {
            id: 'openai',
            name: 'OpenAI',
            logoSrc: '/logos/openai.svg',
            docsUrl: '',
            apiKeyHelpUrl: '',
            pricingDocsUrl: '',
            makeModel: () => ({}),
            listModels: listModelsSpy,
            defaultModels: [{ id: 'whisper-1', displayName: 'Whisper 1', mode: 'batch' }],
            pricing: {},
        },
        {
            id: 'no-validate',
            name: 'No Validate',
            logoSrc: '',
            docsUrl: '',
            apiKeyHelpUrl: '',
            pricingDocsUrl: '',
            makeModel: () => ({}),
            listModels: null,
            defaultModels: [{ id: 'm', displayName: 'M', mode: 'batch' }],
            pricing: {},
        },
    ],
}));

import * as db from '@/lib/db';
import { AddApiKeyDialog } from './AddApiKeyDialog';

beforeEach(() => {
    vi.mocked(db.addApiKey).mockReset();
    listModelsSpy.mockReset();
});

describe('<AddApiKeyDialog />', () => {
    function renderOpen() {
        const onClose = vi.fn();
        const onAdded = vi.fn();
        const result = render(<AddApiKeyDialog open onClose={onClose} onAdded={onAdded} />);
        return { ...result, onClose, onAdded };
    }

    it('lists providers as selectable cards', () => {
        renderOpen();
        expect(screen.getByTestId('provider-card-openai')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('provider-logo-openai')).toHaveAttribute(
            'src',
            '/logos/openai.svg',
        );
        expect(screen.getByTestId('provider-card-no-validate')).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    it('rejects empty nickname or key', async () => {
        const user = userEvent.setup();
        renderOpen();
        await user.click(screen.getByTestId('save-api-key'));
        expect(await screen.findByRole('alert')).toHaveTextContent(/Nickname/);
    });

    it('calls listModels for validation when present and proceeds when it succeeds', async () => {
        listModelsSpy.mockResolvedValueOnce([
            { id: 'whisper-1', displayName: 'Whisper 1', mode: 'batch' },
        ]);
        const user = userEvent.setup();
        const { onAdded } = renderOpen();
        await user.type(screen.getByTestId('nickname-input'), 'Personal');
        await user.type(screen.getByTestId('key-input'), 'sk-test');
        await user.click(screen.getByTestId('save-api-key'));
        await waitFor(() => {
            expect(listModelsSpy).toHaveBeenCalledWith('sk-test');
            expect(db.addApiKey).toHaveBeenCalledWith({
                providerId: 'openai',
                nickname: 'Personal',
                secret: 'sk-test',
            });
            expect(onAdded).toHaveBeenCalled();
        });
    });

    it('shows the error and does not save when validation fails', async () => {
        listModelsSpy.mockRejectedValueOnce(new Error('401 Unauthorized'));
        const user = userEvent.setup();
        const { onAdded } = renderOpen();
        await user.type(screen.getByTestId('nickname-input'), 'Bad');
        await user.type(screen.getByTestId('key-input'), 'sk-bad');
        await user.click(screen.getByTestId('save-api-key'));
        expect(await screen.findByRole('alert')).toHaveTextContent(/401/);
        expect(db.addApiKey).not.toHaveBeenCalled();
        expect(onAdded).not.toHaveBeenCalled();
    });

    it('skips validation when listModels and validateKey are both absent', async () => {
        const user = userEvent.setup();
        const { onAdded } = renderOpen();
        await user.click(screen.getByTestId('provider-card-no-validate'));
        await user.type(screen.getByTestId('nickname-input'), 'X');
        await user.type(screen.getByTestId('key-input'), 'k');
        await user.click(screen.getByTestId('save-api-key'));
        await waitFor(() => {
            expect(db.addApiKey).toHaveBeenCalled();
            expect(onAdded).toHaveBeenCalled();
        });
        expect(listModelsSpy).not.toHaveBeenCalled();
    });
});
