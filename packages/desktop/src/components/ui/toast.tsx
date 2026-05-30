import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface ToastProps {
    message: string;
    open: boolean;
    onClose: () => void;
    /** ms before auto-dismiss. Defaults to 2500. */
    duration?: number;
    /** Optional test id; defaults to "toast". */
    testId?: string;
    /** Visual tone — 'success' is green (default), 'error' is red. */
    variant?: 'success' | 'error';
}

/**
 * Small ephemeral status bar pinned to the bottom-center of the main
 * window. Auto-dismisses after `duration`. Uses a portal so callers can
 * mount it anywhere in the React tree without the layout caring.
 */
export function Toast({
    message,
    open,
    onClose,
    duration = 2500,
    testId = 'toast',
    variant = 'success',
}: ToastProps) {
    useEffect(() => {
        if (!open) return;
        const timer = setTimeout(onClose, duration);
        return () => clearTimeout(timer);
    }, [open, duration, onClose]);

    if (!open) return null;

    return createPortal(
        <output
            aria-live="polite"
            data-testid={testId}
            className={cn(
                'pointer-events-none fixed top-6 right-6 z-50 block',
                'border-3 border-border px-4 py-2 shadow-neo-lg',
                variant === 'error' ? 'bg-red-500/90' : 'bg-green-500/90',
                'text-xs font-bold uppercase tracking-widest text-white',
            )}
        >
            {message}
        </output>,
        document.body,
    );
}
