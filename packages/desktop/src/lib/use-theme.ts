import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useState } from 'react';
import { getTheme as dbGetTheme, setTheme as dbSetTheme } from './db';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_LOCAL_STORAGE_KEY = 'vox-era:resolved-theme';
const DARK_CLASS = 'dark';

function readSystemPreference(): ResolvedTheme {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return 'light';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(preference: Theme): ResolvedTheme {
    return preference === 'system' ? readSystemPreference() : preference;
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (resolved === 'dark') {
        root.classList.add(DARK_CLASS);
    } else {
        root.classList.remove(DARK_CLASS);
    }
    // Sync the webview's reported theme so native scrollbars, form widgets,
    // and the right-click context menu render with the matching palette
    // family. Failures are non-fatal: the CSS theme is applied either way.
    try {
        void getCurrentWindow()
            .setTheme(resolved)
            .catch((err: unknown) => {
                console.warn('useTheme: window.setTheme failed', err);
            });
    } catch (err) {
        console.warn('useTheme: window.setTheme threw synchronously', err);
    }
    // Mirror the resolved value for the next cold start's inline FOUC script
    // (see index.html). Caching the *resolved* value (not the preference)
    // means a System user whose OS theme flips overnight still avoids the
    // wrong-theme flash on relaunch.
    try {
        window.localStorage.setItem(THEME_LOCAL_STORAGE_KEY, resolved);
    } catch {
        // localStorage throws in private/incognito modes; ignore.
    }
}

export interface UseThemeResult {
    /** The user's stored preference (`'light' | 'dark' | 'system'`). */
    preference: Theme;
    /** The effective theme actually being applied right now. */
    resolved: ResolvedTheme;
    /** Persist a new preference and apply it immediately. */
    setPreference: (next: Theme) => Promise<void>;
}

/**
 * Reads the persisted theme preference, resolves it (handling `'system'`
 * via `prefers-color-scheme`), applies `.dark` to `<html>`, mirrors the
 * resolved value to localStorage for the FOUC-prevention inline script,
 * and pushes the resolved value to the Tauri window so native chrome
 * matches.
 *
 * Designed to be safe in both window contexts (`main` and `overlay`):
 * each window has its own React tree, so the hook mounts independently
 * in each.
 */
export function useTheme(): UseThemeResult {
    const [preference, setPreferenceState] = useState<Theme>('system');
    const [resolved, setResolved] = useState<ResolvedTheme>(() => readSystemPreference());

    // Load the persisted preference exactly once on mount.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const stored = await dbGetTheme();
                if (cancelled) return;
                const next = resolveTheme(stored);
                setPreferenceState(stored);
                setResolved(next);
                applyResolvedTheme(next);
            } catch (err) {
                console.error('useTheme: failed to load persisted theme', err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Subscribe to OS theme changes only while preference is 'system'.
    useEffect(() => {
        if (preference !== 'system') return;
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => {
            const next: ResolvedTheme = mql.matches ? 'dark' : 'light';
            setResolved(next);
            applyResolvedTheme(next);
        };
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, [preference]);

    const setPreference = useCallback(async (next: Theme): Promise<void> => {
        try {
            await dbSetTheme(next);
        } catch (err) {
            console.error('useTheme: failed to persist theme', err);
        }
        const resolvedNext = resolveTheme(next);
        setPreferenceState(next);
        setResolved(resolvedNext);
        applyResolvedTheme(resolvedNext);
    }, []);

    return { preference, resolved, setPreference };
}
