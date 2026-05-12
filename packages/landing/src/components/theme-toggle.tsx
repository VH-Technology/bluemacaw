'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function readTheme(): Theme {
    if (typeof window === 'undefined') return 'light';
    const saved = window.localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
}

export function ThemeToggle({ className }: { className?: string }) {
    const [theme, setTheme] = useState<Theme>('light');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setTheme(readTheme());
        setMounted(true);
    }, []);

    function toggle() {
        const next: Theme = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        applyTheme(next);
        try {
            window.localStorage.setItem('theme', next);
        } catch {
            // localStorage may be unavailable (private mode, etc) — toggle still works for the session.
        }
    }

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={
                mounted ? `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode` : 'Toggle theme'
            }
            data-testid="theme-toggle"
            className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-pill',
                'border border-border bg-surface text-fg',
                'hover:bg-muted transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main',
                className,
            )}
        >
            {/* Sun icon — visible in dark mode (clicking goes to light) */}
            <svg
                aria-hidden="true"
                className="hidden h-4 w-4 dark:block"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
            {/* Moon icon — visible in light mode (clicking goes to dark) */}
            <svg
                aria-hidden="true"
                className="block h-4 w-4 dark:hidden"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
        </button>
    );
}
