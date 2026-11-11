import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/use-platform', () => ({ usePlatform: vi.fn() }));
vi.mock('@/lib/invoke', () => ({
    vox: {
        getKeepInDock: vi.fn(async () => true),
        setKeepInDock: vi.fn(async (_enabled: boolean) => undefined),
    },
}));

import { vox } from '@/lib/invoke';
import { usePlatform } from '@/lib/use-platform';
import { SettingsDock } from './SettingsDock';

beforeEach(() => {
    vi.mocked(usePlatform).mockReturnValue({ os: 'macos', isWayland: false });
    vi.mocked(vox.getKeepInDock).mockReset().mockResolvedValue(true);
    vi.mocked(vox.setKeepInDock).mockReset().mockResolvedValue(undefined);
});

describe('Dock preference', () => {
    it('loads and saves the macOS preference', async () => {
        vi.mocked(vox.getKeepInDock).mockResolvedValue(false);
        const user = userEvent.setup();
        render(<SettingsDock />);
        const toggle = screen.getByRole('switch', { name: /keep in dock/i });
        await waitFor(() => expect(toggle).not.toBeDisabled());
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        await user.click(toggle);
        await waitFor(() => expect(vox.setKeepInDock).toHaveBeenCalledWith(true));
        expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it.each(['windows', 'linux'] as const)('is hidden on %s', (os) => {
        vi.mocked(usePlatform).mockReturnValue({ os, isWayland: false });
        const { container } = render(<SettingsDock />);
        expect(container).toBeEmptyDOMElement();
        expect(vox.getKeepInDock).not.toHaveBeenCalled();
    });

    it('keeps the previous value and reports a save failure', async () => {
        vi.mocked(vox.setKeepInDock).mockRejectedValueOnce(new Error('disk full'));
        const user = userEvent.setup();
        render(<SettingsDock />);
        const toggle = screen.getByRole('switch', { name: /keep in dock/i });
        await waitFor(() => expect(toggle).not.toBeDisabled());
        await user.click(toggle);
        expect(await screen.findByRole('alert')).toHaveTextContent(/save/i);
        expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(toggle).not.toBeDisabled();
    });

    it('disables the switch if the preference cannot be loaded', async () => {
        vi.mocked(vox.getKeepInDock).mockRejectedValueOnce(new Error('unavailable'));
        render(<SettingsDock />);
        expect(await screen.findByRole('alert')).toHaveTextContent(/load/i);
        expect(screen.getByRole('switch')).toBeDisabled();
    });
});
