import type { ReactNode } from 'react';

export interface WarningBannerProps {
    children: ReactNode;
    className?: string;
    'data-testid'?: string;
}

/**
 * Inline amber notice used for destructive confirmations and system-level
 * warnings (e.g. "clearing all transcriptions is irreversible", "this will
 * change a global macOS setting"). Replaces a handful of ad-hoc
 * `bg-yellow-100`/`bg-yellow-300` divs that had no explicit text color and
 * went unreadable in dark mode (white-on-pale-yellow).
 */
export function WarningBanner({
    children,
    className = '',
    'data-testid': testId,
}: WarningBannerProps) {
    return (
        <div
            data-testid={testId}
            className={`flex flex-col gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:border-brand-yellow/50 dark:bg-brand-yellow/15 dark:text-brand-yellow ${className}`}
        >
            {children}
        </div>
    );
}
