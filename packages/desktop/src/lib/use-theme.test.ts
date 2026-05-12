import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
    getTheme: vi.fn(async () => 'system'),
    setTheme: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: vi.fn(() => ({ setTheme: vi.fn(async () => undefined) })),
}));

import { getCurrentWindow } from '@tauri-apps/api/window';
import * as db from './db';
import { THEME_LOCAL_STORAGE_KEY, useTheme } from './use-theme';

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
let setThemeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    document.documentElement.classList.remove('dark');
    window.localStorage.clear();
    mql = makeMql(false);
    vi.stubGlobal(
        'matchMedia',
        vi.fn((_query: string) => mql),
    );
    setThemeSpy = vi.fn(async () => undefined);
    vi.mocked(getCurrentWindow).mockReturnValue({
        setTheme: setThemeSpy,
    } as unknown as ReturnType<typeof getCurrentWindow>);
    vi.mocked(db.getTheme).mockResolvedValue('system');
    vi.mocked(db.setTheme).mockResolvedValue(undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('useTheme', () => {
    it("defaults to 'system' and resolves to dark when prefers-color-scheme is dark", async () => {
        mql.matches = true;
        const { result } = renderHook(() => useTheme());
        await waitFor(() => {
            expect(result.current.preference).toBe('system');
            expect(result.current.resolved).toBe('dark');
        });
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(setThemeSpy).toHaveBeenCalledWith('dark');
        expect(window.localStorage.getItem(THEME_LOCAL_STORAGE_KEY)).toBe('dark');
    });

    it("defaults to 'system' and resolves to light when prefers-color-scheme is light", async () => {
        mql.matches = false;
        const { result } = renderHook(() => useTheme());
        await waitFor(() => expect(result.current.resolved).toBe('light'));
        expect(document.documentElement.classList.contains('dark')).toBe(false);
        expect(setThemeSpy).toHaveBeenCalledWith('light');
        expect(window.localStorage.getItem(THEME_LOCAL_STORAGE_KEY)).toBe('light');
    });

    it("respects explicit 'dark' preference even when the system prefers light", async () => {
        mql.matches = false;
        vi.mocked(db.getTheme).mockResolvedValue('dark');
        const { result } = renderHook(() => useTheme());
        await waitFor(() => {
            expect(result.current.preference).toBe('dark');
            expect(result.current.resolved).toBe('dark');
        });
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it("respects explicit 'light' preference even when the system prefers dark", async () => {
        mql.matches = true;
        vi.mocked(db.getTheme).mockResolvedValue('light');
        const { result } = renderHook(() => useTheme());
        await waitFor(() => {
            expect(result.current.preference).toBe('light');
            expect(result.current.resolved).toBe('light');
        });
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it("reacts to live media-query changes when preference is 'system'", async () => {
        mql.matches = false;
        const { result } = renderHook(() => useTheme());
        await waitFor(() => expect(result.current.resolved).toBe('light'));
        act(() => mql.dispatch(true));
        await waitFor(() => expect(result.current.resolved).toBe('dark'));
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        // setTheme is called once for the initial resolve and again for the
        // media-query change — the latest call is the new resolution.
        expect(setThemeSpy).toHaveBeenLastCalledWith('dark');
    });

    it('ignores media-query changes when preference is explicit', async () => {
        mql.matches = false;
        vi.mocked(db.getTheme).mockResolvedValue('light');
        const { result } = renderHook(() => useTheme());
        await waitFor(() => expect(result.current.resolved).toBe('light'));
        act(() => mql.dispatch(true));
        // No re-render to dark; explicit preference wins.
        expect(result.current.resolved).toBe('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('setPreference persists via db.setTheme and re-applies', async () => {
        const { result } = renderHook(() => useTheme());
        await waitFor(() => expect(result.current.preference).toBe('system'));
        await act(async () => {
            await result.current.setPreference('dark');
        });
        expect(db.setTheme).toHaveBeenCalledWith('dark');
        expect(result.current.preference).toBe('dark');
        expect(result.current.resolved).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(setThemeSpy).toHaveBeenLastCalledWith('dark');
        expect(window.localStorage.getItem(THEME_LOCAL_STORAGE_KEY)).toBe('dark');
    });
});
