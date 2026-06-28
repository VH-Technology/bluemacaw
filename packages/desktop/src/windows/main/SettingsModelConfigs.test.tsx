import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
    listApiKeys: vi.fn(async () => []),
    listModelConfigs: vi.fn(),
    getActiveModelConfigId: vi.fn(),
    setActiveModelConfigId: vi.fn(),
    deleteModelConfig: vi.fn(),
    addModelConfig: vi.fn(),
}));

import * as db from '@/lib/db';
import { SettingsModelConfigs } from './SettingsModelConfigs';

const config = {
    id: 'mc-1',
    apiKeyId: 'key-1',
    modelId: 'whisper-1',
    providerId: 'openai',
    apiKeyNickname: 'Personal',
};

beforeEach(() => {
    vi.mocked(db.listModelConfigs).mockReset();
    vi.mocked(db.getActiveModelConfigId).mockReset();
    vi.mocked(db.setActiveModelConfigId).mockReset();
    vi.mocked(db.deleteModelConfig).mockReset();
});

describe('<SettingsModelConfigs />', () => {
    it('shows empty state when there are no configs', async () => {
        vi.mocked(db.listModelConfigs).mockResolvedValueOnce([]);
        vi.mocked(db.getActiveModelConfigId).mockResolvedValueOnce(null);
        render(<SettingsModelConfigs />);
        expect(await screen.findByTestId('model-configs-empty')).toBeInTheDocument();
    });

    it('renders configs and marks the active one', async () => {
        vi.mocked(db.listModelConfigs).mockResolvedValueOnce([config]);
        vi.mocked(db.getActiveModelConfigId).mockResolvedValueOnce('mc-1');
        render(<SettingsModelConfigs />);
        const row = await screen.findByTestId('model-config-row-mc-1');
        expect(row).toHaveAttribute('data-active', 'true');
        expect(row).toHaveTextContent('whisper-1');
    });

    it('shows a realtime tag for saved realtime model configs', async () => {
        vi.mocked(db.listModelConfigs).mockResolvedValueOnce([
            {
                ...config,
                id: 'mc-realtime',
                modelId: 'scribe_v2_realtime',
                providerId: 'elevenlabs',
            },
        ]);
        vi.mocked(db.getActiveModelConfigId).mockResolvedValueOnce(null);
        render(<SettingsModelConfigs />);
        const row = await screen.findByTestId('model-config-row-mc-realtime');
        expect(row).toHaveTextContent('Realtime');
    });

    it('clicking a non-active row sets it active and re-marks', async () => {
        vi.mocked(db.listModelConfigs).mockResolvedValueOnce([config]);
        vi.mocked(db.getActiveModelConfigId).mockResolvedValueOnce(null);
        const user = userEvent.setup();
        render(<SettingsModelConfigs />);
        await user.click(await screen.findByTestId('select-model-config-mc-1'));
        await waitFor(() => {
            expect(db.setActiveModelConfigId).toHaveBeenCalledWith('mc-1');
        });
        await waitFor(() => {
            expect(screen.getByTestId('model-config-row-mc-1')).toHaveAttribute(
                'data-active',
                'true',
            );
        });
    });

    it('deletes a config without bubbling the click to the row', async () => {
        vi.mocked(db.listModelConfigs).mockResolvedValueOnce([config]);
        vi.mocked(db.getActiveModelConfigId).mockResolvedValueOnce(null);
        vi.mocked(db.listModelConfigs).mockResolvedValueOnce([]);
        vi.mocked(db.getActiveModelConfigId).mockResolvedValueOnce(null);
        const user = userEvent.setup();
        render(<SettingsModelConfigs />);
        await user.click(await screen.findByTestId('delete-model-config-mc-1'));
        await waitFor(() => {
            expect(db.deleteModelConfig).toHaveBeenCalledWith('mc-1');
        });
        expect(db.setActiveModelConfigId).not.toHaveBeenCalled();
    });

    it('opens the add dialog when Add Model Config is clicked', async () => {
        vi.mocked(db.listModelConfigs).mockResolvedValueOnce([]);
        vi.mocked(db.getActiveModelConfigId).mockResolvedValueOnce(null);
        const user = userEvent.setup();
        render(<SettingsModelConfigs />);
        await user.click(await screen.findByTestId('add-model-config'));
        expect(await screen.findByTestId('add-model-config-dialog')).toBeInTheDocument();
    });
});
