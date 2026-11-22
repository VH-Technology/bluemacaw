import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/use-platform', () => ({ usePlatform: vi.fn() }));
vi.mock('@/lib/db', () => ({
    DEFAULT_INSERTION_METHOD: 'paste',
    getInsertionMethod: vi.fn(async () => 'paste'),
    setInsertionMethod: vi.fn(async () => undefined),
    getPasteLastHotkeyCombo: vi.fn(async () => null),
    setPasteLastHotkeyCombo: vi.fn(async () => undefined),
}));
vi.mock('@/lib/invoke', () => ({
    vox: {
        registerPasteLastHotkey: vi.fn(async (combo: string) => combo),
        unregisterPasteLastHotkey: vi.fn(async () => undefined),
    },
}));

import {
    getInsertionMethod,
    getPasteLastHotkeyCombo,
    setInsertionMethod,
    setPasteLastHotkeyCombo,
} from '@/lib/db';
import { vox } from '@/lib/invoke';
import { usePlatform } from '@/lib/use-platform';
import { SettingsInsertion } from './SettingsInsertion';

beforeEach(() => {
    vi.mocked(usePlatform).mockReturnValue({ os: 'macos', isWayland: false });
    vi.mocked(getInsertionMethod).mockReset().mockResolvedValue('paste');
    vi.mocked(setInsertionMethod).mockReset().mockResolvedValue(undefined);
    vi.mocked(getPasteLastHotkeyCombo).mockReset().mockResolvedValue(null);
    vi.mocked(setPasteLastHotkeyCombo).mockReset().mockResolvedValue(undefined);
    vi.mocked(vox.registerPasteLastHotkey)
        .mockReset()
        .mockImplementation(async (combo) => combo);
    vi.mocked(vox.unregisterPasteLastHotkey).mockReset().mockResolvedValue(undefined);
});

function pressCombo() {
    window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true }),
    );
}

describe('insertion method', () => {
    it('shows the saved method and saves a new choice', async () => {
        const user = userEvent.setup();
        render(<SettingsInsertion />);
        const select = screen.getByLabelText(/insert transcripts by/i);
        await waitFor(() => expect(select).not.toBeDisabled());
        expect(select).toHaveValue('paste');
        expect(screen.getByText(/put back/i)).toBeInTheDocument();

        await user.selectOptions(select, 'type');

        await waitFor(() => expect(setInsertionMethod).toHaveBeenCalledWith('type'));
        expect(select).toHaveValue('type');
        expect(screen.getByText(/never touches your clipboard/i)).toBeInTheDocument();
    });

    it('keeps the previous method and reports a save failure', async () => {
        vi.mocked(setInsertionMethod).mockRejectedValueOnce(new Error('disk full'));
        const user = userEvent.setup();
        render(<SettingsInsertion />);
        const select = screen.getByLabelText(/insert transcripts by/i);
        await waitFor(() => expect(select).not.toBeDisabled());

        await user.selectOptions(select, 'type');

        expect(await screen.findByRole('alert')).toHaveTextContent(/save/i);
        expect(select).toHaveValue('paste');
    });

    it('is not offered on Linux, where only pasting is available', async () => {
        vi.mocked(usePlatform).mockReturnValue({ os: 'linux', isWayland: false });
        render(<SettingsInsertion />);
        await waitFor(() => expect(getPasteLastHotkeyCombo).toHaveBeenCalled());
        expect(screen.queryByLabelText(/insert transcripts by/i)).not.toBeInTheDocument();
    });
});

describe('paste last transcription shortcut', () => {
    it('is unset until the user captures one, then is saved and registered', async () => {
        render(<SettingsInsertion />);
        await waitFor(() =>
            expect(screen.getByTestId('hotkey-display')).toHaveTextContent('Not set'),
        );
        expect(screen.getByRole('button', { name: /clear/i })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        pressCombo();

        await waitFor(() => {
            expect(setPasteLastHotkeyCombo).toHaveBeenCalledWith('Ctrl+Shift+V');
            expect(vox.registerPasteLastHotkey).toHaveBeenCalledWith('Ctrl+Shift+V');
        });
        expect(screen.getByTestId('hotkey-display')).toHaveTextContent('Ctrl+Shift+V');
    });

    it('frees the current shortcut while a new one is being captured', async () => {
        vi.mocked(getPasteLastHotkeyCombo).mockResolvedValue('Ctrl+Shift+V');
        render(<SettingsInsertion />);
        await waitFor(() =>
            expect(screen.getByTestId('hotkey-display')).toHaveTextContent('Ctrl+Shift+V'),
        );

        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        await waitFor(() => expect(vox.unregisterPasteLastHotkey).toHaveBeenCalled());

        // Cancelling restores the shortcut that was there before.
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        await waitFor(() =>
            expect(vox.registerPasteLastHotkey).toHaveBeenCalledWith('Ctrl+Shift+V'),
        );
    });

    it('clears the shortcut', async () => {
        vi.mocked(getPasteLastHotkeyCombo).mockResolvedValue('Ctrl+Shift+V');
        const user = userEvent.setup();
        render(<SettingsInsertion />);
        const clear = screen.getByRole('button', { name: /clear/i });
        await waitFor(() => expect(clear).not.toBeDisabled());

        await user.click(clear);

        await waitFor(() => {
            expect(setPasteLastHotkeyCombo).toHaveBeenCalledWith(null);
            expect(vox.unregisterPasteLastHotkey).toHaveBeenCalled();
        });
        expect(screen.getByTestId('hotkey-display')).toHaveTextContent('Not set');
    });

    it('does not save a combo the system refuses to register', async () => {
        vi.mocked(vox.registerPasteLastHotkey).mockRejectedValueOnce(
            new Error('shortcut already registered'),
        );
        render(<SettingsInsertion />);
        await waitFor(() =>
            expect(screen.getByTestId('hotkey-display')).toHaveTextContent('Not set'),
        );

        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        pressCombo();

        expect(await screen.findByRole('alert')).toHaveTextContent(/already registered/i);
        expect(setPasteLastHotkeyCombo).not.toHaveBeenCalled();
        expect(screen.getByTestId('hotkey-display')).toHaveTextContent('Not set');
    });
});
