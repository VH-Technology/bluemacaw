'use client';

import { cn } from '@/lib/utils';
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/**
 * Storage keys shared by the FOUC boot script in `app/layout.tsx`.
 * Match the desktop's conventions so reasoning is uniform across packages.
 *
 * - `PREFERENCE_KEY` holds the user's choice (`'light' | 'dark' | 'system'`).
 * - `RESOLVED_KEY` holds the actually-applied theme (`'light' | 'dark'`).
 *   The boot script reads this synchronously to avoid FOUC on cold start.
 */
export const PREFERENCE_KEY = 'bluemacaw:theme-preference';
export const RESOLVED_KEY = 'bluemacaw:resolved-theme';

const CYCLE: Record<Theme, Theme> = {
    light: 'dark',
    dark: 'system',
    system: 'light',
};

function readPreference(): Theme {
    if (typeof window === 'undefined') return 'system';
    const saved = window.localStorage.getItem(PREFERENCE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return 'system';
}

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
    if (resolved === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
        window.localStorage.setItem(RESOLVED_KEY, resolved);
    } catch {
        // localStorage throws in private modes; the in-memory class is still set.
    }
}

function labelFor(preference: Theme, resolved: ResolvedTheme): string {
    if (preference === 'system') return `System (currently ${resolved})`;
    return preference === 'dark' ? 'Dark' : 'Light';
}

export function ThemeToggle({ className }: { className?: string }) {
    // Start with system / readSystemPreference so SSR + the FOUC script
    // agree with the first React paint; the actual saved preference is
    // hydrated in the mount effect below.
    const [preference, setPreference] = useState<Theme>('system');
    const [resolved, setResolved] = useState<ResolvedTheme>('light');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const savedPref = readPreference();
        const next = resolveTheme(savedPref);
        setPreference(savedPref);
        setResolved(next);
        applyResolvedTheme(next);
        setMounted(true);
    }, []);

    // Subscribe to OS theme changes only while preference is 'system'.
    useEffect(() => {
        if (!mounted) return;
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
    }, [mounted, preference]);

    const cycle = useCallback(() => {
        setPreference((current) => {
            const next = CYCLE[current];
            try {
                window.localStorage.setItem(PREFERENCE_KEY, next);
            } catch {
                // ignore
            }
            const resolvedNext = resolveTheme(next);
            setResolved(resolvedNext);
            applyResolvedTheme(resolvedNext);
            return next;
        });
    }, []);

    const label = mounted ? labelFor(preference, resolved) : 'Toggle theme';

    return (
        <button
            type="button"
            onClick={cycle}
            aria-label={mounted ? `Theme: ${label}. Click to switch.` : 'Toggle theme'}
            title={label}
            data-testid="theme-toggle"
            data-preference={mounted ? preference : undefined}
            data-resolved={mounted ? resolved : undefined}
            className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-pill',
                'border border-border bg-surface text-fg',
                'hover:bg-muted transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main',
                className,
            )}
        >
            {/* Sun — visible when the resolved theme is dark (one click → system). */}
            <svg
                aria-hidden="true"
                className="hidden h-4 w-4 dark:block"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                data-testid="theme-toggle-icon-sun"
            >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
            {/* Moon — visible when resolved is light. Preference may still be 'system'
                (which currently resolves to light); the icon reflects what you SEE, the
                aria-label tells you what's next. */}
            <svg
                aria-hidden="true"
                className="block h-4 w-4 dark:hidden"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                data-testid="theme-toggle-icon-moon"
            >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
        </button>
    );
}
