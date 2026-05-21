import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/use-platform', () => ({
    usePlatform: vi.fn(),
}));

import { usePlatform } from '@/lib/use-platform';
import { HotkeyInput } from './HotkeyInput';

beforeEach(() => {
    vi.mocked(usePlatform).mockReset();
    vi.mocked(usePlatform).mockReturnValue({ os: 'macos', isWayland: false });
});

describe('HotkeyInput', () => {
    it('renders the current combo when idle', () => {
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={() => {}} />);
        expect(screen.getByText('Cmd+Shift+Space')).toBeInTheDocument();
    });

    it('captures a combo when the user clicks Capture and presses keys', () => {
        const onChange = vi.fn();
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        // simulate Shift+A
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', shiftKey: true }),
            );
        });
        expect(onChange).toHaveBeenCalledWith('Shift+A');
    });

    it('ignores modifier-only key events while capturing', () => {
        const onChange = vi.fn();
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft' }));
        });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('Esc cancels capture without firing onChange', () => {
        const onChange = vi.fn();
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
        });
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText('Cmd+Shift+Space')).toBeInTheDocument();
    });

    it('refuses combos with no modifier', () => {
        const onChange = vi.fn();
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', code: 'KeyA' }));
        });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows the "Use Fn" button on macOS', () => {
        vi.mocked(usePlatform).mockReturnValue({ os: 'macos', isWayland: false });
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={() => {}} />);
        expect(screen.getByRole('button', { name: /use fn/i })).toBeInTheDocument();
    });

    it('hides the "Use Fn" button off macOS', () => {
        vi.mocked(usePlatform).mockReturnValue({ os: 'windows', isWayland: false });
        render(<HotkeyInput value="Ctrl+Shift+Space" onChange={() => {}} />);
        expect(screen.queryByRole('button', { name: /use fn/i })).not.toBeInTheDocument();
    });

    it('hides the "Use Fn" button while platform info is still loading', () => {
        vi.mocked(usePlatform).mockReturnValue(null);
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={() => {}} />);
        expect(screen.queryByRole('button', { name: /use fn/i })).not.toBeInTheDocument();
    });

    // ---- Modifier-only chord capture ---------------------------------

    it('captures a modifier-only chord (Cmd+Opt) on macOS', () => {
        const onChange = vi.fn();
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        act(() => {
            // Press Cmd, then Opt (both modifiers held).
            window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }),
            );
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Alt',
                    code: 'AltLeft',
                    metaKey: true,
                    altKey: true,
                }),
            );
            // Release both — the order of release shouldn't matter.
            window.dispatchEvent(
                new KeyboardEvent('keyup', {
                    key: 'Meta',
                    code: 'MetaLeft',
                    metaKey: false,
                    altKey: true,
                }),
            );
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', code: 'AltLeft' }));
        });
        expect(onChange).toHaveBeenCalledWith('Cmd+Alt');
    });

    it('emits chord parts in stable Cmd+Ctrl+Alt+Shift order', () => {
        const onChange = vi.fn();
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        act(() => {
            // Press in deliberately wrong order: Shift, Cmd, Ctrl.
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Shift',
                    code: 'ShiftLeft',
                    shiftKey: true,
                }),
            );
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Meta',
                    code: 'MetaLeft',
                    metaKey: true,
                    shiftKey: true,
                }),
            );
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Control',
                    code: 'ControlLeft',
                    ctrlKey: true,
                    metaKey: true,
                    shiftKey: true,
                }),
            );
            // Release all.
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft' }));
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft' }));
            window.dispatchEvent(
                new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft' }),
            );
        });
        expect(onChange).toHaveBeenCalledWith('Cmd+Ctrl+Shift');
    });

    it('drops a single-modifier press without committing on macOS', () => {
        const onChange = vi.fn();
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }),
            );
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft' }));
        });
        // Single Cmd tap is held back as a possible double-tap
        // candidate; nothing should commit yet.
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not offer chord captures off macOS', () => {
        vi.mocked(usePlatform).mockReturnValue({ os: 'windows', isWayland: false });
        const onChange = vi.fn();
        render(<HotkeyInput value="Ctrl+Shift+Space" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Control',
                    code: 'ControlLeft',
                    ctrlKey: true,
                }),
            );
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Alt',
                    code: 'AltLeft',
                    ctrlKey: true,
                    altKey: true,
                }),
            );
            window.dispatchEvent(
                new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft' }),
            );
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', code: 'AltLeft' }));
        });
        // Modifier-only chord is macOS-only; off-platform the press is
        // dropped silently rather than emitting an unsupported combo.
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not offer chord captures when allowChord=false', () => {
        const onChange = vi.fn();
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={onChange} allowChord={false} />);
        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }),
            );
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Alt',
                    code: 'AltLeft',
                    metaKey: true,
                    altKey: true,
                }),
            );
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft' }));
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', code: 'AltLeft' }));
        });
        expect(onChange).not.toHaveBeenCalled();
    });

    // ---- Double-tap modifier capture --------------------------------

    it('captures a double-tap of a single modifier on macOS', () => {
        const onChange = vi.fn();
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        act(() => {
            // First tap of Cmd
            window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }),
            );
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft' }));
            // Second tap of Cmd, immediately after
            window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }),
            );
        });
        expect(onChange).toHaveBeenCalledWith('DoubleTap+Cmd');
    });

    it('does not fire double-tap when a different modifier is pressed second', () => {
        const onChange = vi.fn();
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }),
            );
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', code: 'MetaLeft' }));
            window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Alt', code: 'AltLeft', altKey: true }),
            );
        });
        expect(onChange).not.toHaveBeenCalled();
    });

    // ---- Standard combo still works through the new path ------------

    it('still captures a Cmd+Opt+S combo (modifier + non-modifier)', () => {
        const onChange = vi.fn();
        render(<HotkeyInput value="Cmd+Shift+Space" onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: /capture/i }));
        act(() => {
            window.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }),
            );
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Alt',
                    code: 'AltLeft',
                    metaKey: true,
                    altKey: true,
                }),
            );
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'S',
                    code: 'KeyS',
                    metaKey: true,
                    altKey: true,
                }),
            );
        });
        expect(onChange).toHaveBeenCalledWith('Cmd+Alt+S');
    });
});
