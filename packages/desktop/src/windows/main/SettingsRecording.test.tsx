import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsRecording } from './SettingsRecording';

vi.mock('@/lib/invoke', () => ({
    vox: {
        listAudioInputDevices: vi.fn(),
        startRecording: vi.fn(),
        stopRecording: vi.fn(),
        registerHotkey: vi.fn(),
        unregisterHotkey: vi.fn(),
        registerCancelHotkey: vi.fn(),
        unregisterCancelHotkey: vi.fn(),
        getPlatformInfo: vi.fn(async () => ({ os: 'macos', isWayland: false })),
    },
}));
vi.mock('@/lib/db', () => ({
    getSelectedMicDeviceId: vi.fn(),
    setSelectedMicDeviceId: vi.fn(),
    getHotkeyCombo: vi.fn(),
    setHotkeyCombo: vi.fn(),
    getCancelHotkeyCombo: vi.fn(),
    setCancelHotkeyCombo: vi.fn(),
}));

import {
    getCancelHotkeyCombo,
    getHotkeyCombo,
    getSelectedMicDeviceId,
    setCancelHotkeyCombo,
    setHotkeyCombo,
    setSelectedMicDeviceId,
} from '@/lib/db';
import { vox } from '@/lib/invoke';

const voxMock = vi.mocked(vox);
const getSelectedMicDeviceIdMock = vi.mocked(getSelectedMicDeviceId);
const setSelectedMicDeviceIdMock = vi.mocked(setSelectedMicDeviceId);
const getHotkeyComboMock = vi.mocked(getHotkeyCombo);
const setHotkeyComboMock = vi.mocked(setHotkeyCombo);
const getCancelHotkeyComboMock = vi.mocked(getCancelHotkeyCombo);
const setCancelHotkeyComboMock = vi.mocked(setCancelHotkeyCombo);

beforeEach(() => {
    voxMock.listAudioInputDevices.mockResolvedValue([
        { id: 'usb', label: 'USB Mic', isDefault: false },
        { id: 'builtin', label: 'Built-in', isDefault: true },
    ]);
    voxMock.registerHotkey.mockResolvedValue('Cmd+Shift+Space');
    voxMock.registerCancelHotkey.mockResolvedValue('Cmd+Esc');
    voxMock.unregisterCancelHotkey.mockResolvedValue();
    getSelectedMicDeviceIdMock.mockResolvedValue(null);
    getHotkeyComboMock.mockResolvedValue('Cmd+Shift+Space');
    getCancelHotkeyComboMock.mockResolvedValue('Cmd+Esc');
    setSelectedMicDeviceIdMock.mockResolvedValue();
    setHotkeyComboMock.mockResolvedValue();
    setCancelHotkeyComboMock.mockResolvedValue();
});

describe('SettingsRecording', () => {
    it('loads + renders the device list with System default first', async () => {
        render(<SettingsRecording />);
        await waitFor(() => {
            expect(screen.getByLabelText(/microphone/i)).toBeInTheDocument();
        });
        const select = screen.getByLabelText(/microphone/i) as HTMLSelectElement;
        expect(select.options[0]?.textContent).toMatch(/system default/i);
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
            'System default',
            'USB Mic',
            'Built-in',
        ]);
    });

    it('persists the selected mic on change', async () => {
        render(<SettingsRecording />);
        // `vox.listAudioInputDevices()` resolves on a microtask after the
        // initial render, so the <select> exists before its <option>s do.
        // Waiting only for the label races on Ubuntu CI: fireEvent.change
        // fires before the `usb` option is in the DOM, the browser rejects
        // the value as "not a valid option", value stays as '', and React
        // reports the change as '' — which the handler then maps to null.
        // Wait for the device-list option itself instead.
        await screen.findByRole('option', { name: 'USB Mic' });
        const select = screen.getByLabelText(/microphone/i) as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'usb' } });
        await waitFor(() => {
            expect(setSelectedMicDeviceIdMock).toHaveBeenCalledWith('usb');
        });
    });

    it('persists null when System default is chosen', async () => {
        getSelectedMicDeviceIdMock.mockResolvedValueOnce('usb');
        render(<SettingsRecording />);
        // Same option-availability race as above. Even though '' is always
        // a valid option, the controlled select's value can only flip away
        // from 'usb' once the options have been hydrated.
        await screen.findByRole('option', { name: 'USB Mic' });
        const select = screen.getByLabelText(/microphone/i) as HTMLSelectElement;
        fireEvent.change(select, { target: { value: '' } });
        await waitFor(() => {
            expect(setSelectedMicDeviceIdMock).toHaveBeenCalledWith(null);
        });
    });

    it('persists + registers a new hotkey when the user captures one', async () => {
        render(<SettingsRecording />);
        await waitFor(() => screen.getByLabelText(/microphone/i));
        // Two HotkeyInputs are rendered (one for the toggle hotkey, one for
        // the cancel hotkey), both with a "Capture…" button. The first one
        // is the toggle-hotkey input — the order is fixed by the JSX in
        // `SettingsRecording`.
        const captureButtons = screen.getAllByRole('button', { name: /capture/i });
        fireEvent.click(captureButtons[0] as HTMLElement);
        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', metaKey: true, shiftKey: true }),
        );
        await waitFor(() => {
            expect(setHotkeyComboMock).toHaveBeenCalledWith('Cmd+Shift+A');
            expect(voxMock.registerHotkey).toHaveBeenCalledWith('Cmd+Shift+A');
        });
    });

    it('persists + registers a new cancel hotkey when the user captures one', async () => {
        render(<SettingsRecording />);
        await waitFor(() => screen.getByLabelText(/microphone/i));
        const captureButtons = screen.getAllByRole('button', { name: /capture/i });
        // Second Capture button drives the cancel-hotkey input.
        fireEvent.click(captureButtons[1] as HTMLElement);
        window.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Backspace',
                code: 'Backspace',
                metaKey: true,
            }),
        );
        await waitFor(() => {
            expect(setCancelHotkeyComboMock).toHaveBeenCalledWith('Cmd+Backspace');
            expect(voxMock.registerCancelHotkey).toHaveBeenCalledWith('Cmd+Backspace');
        });
    });
});
