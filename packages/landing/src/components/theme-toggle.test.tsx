import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFERENCE_KEY, RESOLVED_KEY, ThemeToggle } from './theme-toggle';

interface MockMql {
    matches: boolean;
    listeners: Array<(e: { matches: boolean }) => void>;
    addEventListener: (event: string, cb: (e: { matches: boolean }) => void) => void;
    removeEventListener: (event: string, cb: (e: { matches: boolean }) => void) => void;
    dispatch: (matches: boolean) => void;
}

function makeMql(initialMatches: boolean): MockMql {
    const m: MockMql = {
        matches: initialMatches,
        listeners: [],
        addEventListener: (event, cb) => {
            if (event === 'change') m.listeners.push(cb);
        },
        removeEventListener: (event, cb) => {
            if (event !== 'change') return;
            const idx = m.listeners.indexOf(cb);
            if (idx >= 0) m.listeners.splice(idx, 1);
        },
        dispatch: (matches) => {
            m.matches = matches;
            for (const l of m.listeners) l({ matches });
        },
    };
    return m;
}

let mql: MockMql;

function stubMatchMedia(matches: boolean) {
    mql = makeMql(matches);
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn(() => mql),
    });
}

beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    stubMatchMedia(false);
});

afterEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
});

describe('ThemeToggle', () => {
    it('defaults to system + resolves to light when the OS reports light', () => {
        render(<ThemeToggle />);
        const button = screen.getByTestId('theme-toggle');
        expect(button.dataset.preference).toBe('system');
        expect(button.dataset.resolved).toBe('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('defaults to system + resolves to dark when the OS reports dark', () => {
        stubMatchMedia(true);
        render(<ThemeToggle />);
        const button = screen.getByTestId('theme-toggle');
        expect(button.dataset.preference).toBe('system');
        expect(button.dataset.resolved).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('flips the visible theme on every click (no no-op system step)', () => {
        // OS reports light (stubMatchMedia(false)), so the default resolves to
        // light. Each click must change what the user sees.
        render(<ThemeToggle />);
        const button = screen.getByTestId('theme-toggle');
        expect(button.dataset.resolved).toBe('light');

        // Click 1: light → dark (single click flips, even from the system default).
        fireEvent.click(button);
        expect(button.dataset.preference).toBe('dark');
        expect(button.dataset.resolved).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(window.localStorage.getItem(PREFERENCE_KEY)).toBe('dark');
        expect(window.localStorage.getItem(RESOLVED_KEY)).toBe('dark');

        // Click 2: dark → light.
        fireEvent.click(button);
        expect(button.dataset.preference).toBe('light');
        expect(button.dataset.resolved).toBe('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
        expect(window.localStorage.getItem(PREFERENCE_KEY)).toBe('light');
        expect(window.localStorage.getItem(RESOLVED_KEY)).toBe('light');

        // Click 3: light → dark again (always flips).
        fireEvent.click(button);
        expect(button.dataset.resolved).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it("reacts to live media-query changes only while preference is 'system'", () => {
        render(<ThemeToggle />);
        const button = screen.getByTestId('theme-toggle');

        // Default is system + light.
        expect(button.dataset.resolved).toBe('light');

        // Flip OS to dark while in system mode — resolved follows.
        act(() => mql.dispatch(true));
        expect(button.dataset.resolved).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        // Click to pin to light (cycle: system → light). Subsequent OS flips ignored.
        fireEvent.click(button);
        expect(button.dataset.preference).toBe('light');
        act(() => mql.dispatch(true));
        expect(button.dataset.resolved).toBe('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('reads saved preference on mount', () => {
        window.localStorage.setItem(PREFERENCE_KEY, 'dark');
        render(<ThemeToggle />);
        const button = screen.getByTestId('theme-toggle');
        expect(button.dataset.preference).toBe('dark');
        expect(button.dataset.resolved).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
});
