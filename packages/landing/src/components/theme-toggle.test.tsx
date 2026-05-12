import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
    beforeEach(() => {
        window.localStorage.clear();
        document.documentElement.classList.remove('dark');
        // happy-dom returns false from matchMedia by default; pin it explicitly
        // so the boot-time read in the component doesn't accidentally land on dark.
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation(() => ({
                matches: false,
                media: '',
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        });
    });

    afterEach(() => {
        window.localStorage.clear();
        document.documentElement.classList.remove('dark');
    });

    it('toggles the dark class on <html> when clicked', () => {
        render(<ThemeToggle />);
        const button = screen.getByTestId('theme-toggle');

        expect(document.documentElement.classList.contains('dark')).toBe(false);

        fireEvent.click(button);
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(window.localStorage.getItem('theme')).toBe('dark');

        fireEvent.click(button);
        expect(document.documentElement.classList.contains('dark')).toBe(false);
        expect(window.localStorage.getItem('theme')).toBe('light');
    });
});
