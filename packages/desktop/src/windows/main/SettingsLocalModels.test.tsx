import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/invoke', () => ({
    vox: {
        listLocalModels: vi.fn().mockResolvedValue([]),
        deleteLocalModel: vi.fn().mockResolvedValue(undefined),
        cancelModelDownload: vi.fn().mockResolvedValue(undefined),
        downloadWhisperModel: vi.fn().mockResolvedValue('/fake/path/model.gguf'),
    },
}));

vi.mock('@/lib/db', () => ({
    getActiveLocalModelId: vi.fn().mockResolvedValue(null),
    setActiveLocalModelId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

import { SettingsLocalModels } from './SettingsLocalModels';

describe('SettingsLocalModels', () => {
    it('renders the section heading', async () => {
        render(<SettingsLocalModels />);
        expect(await screen.findByText('Local models (on-device)')).toBeDefined();
    });

    it('shows download button', async () => {
        render(<SettingsLocalModels />);
        expect(await screen.findByTestId('local-models-download-btn')).toBeDefined();
    });
});
