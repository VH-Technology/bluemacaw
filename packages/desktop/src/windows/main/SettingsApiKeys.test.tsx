import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
    listApiKeys: vi.fn(),
    listModelConfigDependencies: vi.fn(async () => []),
    getActiveModelConfigId: vi.fn(async () => null),
    deleteApiKey: vi.fn(),
    addApiKey: vi.fn(),
}));

import * as db from '@/lib/db';
import { SettingsApiKeys } from './SettingsApiKeys';

beforeEach(() => {
    vi.mocked(db.listApiKeys).mockReset();
    vi.mocked(db.listModelConfigDependencies).mockReset().mockResolvedValue([]);
    vi.mocked(db.getActiveModelConfigId).mockReset().mockResolvedValue(null);
});

describe('<SettingsApiKeys />', () => {
    it('shows empty state when no keys exist', async () => {
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([]);
        render(<SettingsApiKeys />);
        expect(await screen.findByTestId('api-keys-empty')).toBeInTheDocument();
    });

    it('lists existing keys', async () => {
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([
            {
                id: 'key-1',
                providerId: 'openai',
                nickname: 'Personal',
                createdAt: '2026-05-09',
            },
        ]);
        render(<SettingsApiKeys />);
        const row = await screen.findByTestId('api-key-row-key-1');
        expect(row).toHaveTextContent('Personal');
        expect(row).toHaveTextContent('OpenAI');
        expect(screen.getByTestId('provider-logo-openai')).toBeInTheDocument();
    });

    it('opens the add dialog when Add API Key is clicked', async () => {
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([]);
        const user = userEvent.setup();
        render(<SettingsApiKeys />);
        await user.click(await screen.findByTestId('add-api-key'));
        expect(await screen.findByTestId('add-api-key-dialog')).toBeInTheDocument();
    });

    it('opens the delete dialog when Delete is clicked on a row', async () => {
        vi.mocked(db.listApiKeys).mockResolvedValueOnce([
            {
                id: 'key-1',
                providerId: 'openai',
                nickname: 'Personal',
                createdAt: '2026-05-09',
            },
        ]);
        const user = userEvent.setup();
        render(<SettingsApiKeys />);
        await user.click(await screen.findByTestId('delete-api-key-key-1'));
        expect(await screen.findByTestId('delete-api-key-dialog')).toBeInTheDocument();
        await waitFor(() => {
            expect(db.listModelConfigDependencies).toHaveBeenCalledWith('key-1');
        });
    });
});
