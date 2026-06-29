import { cn } from '@/lib/utils';
import * as React from 'react';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    wrapperClassName?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
    ({ className, wrapperClassName, children, ...props }, ref) => (
        <div className={cn('relative', wrapperClassName)}>
            <select
                ref={ref}
                className={cn(
                    'h-10 w-full appearance-none rounded-xl border border-border bg-surface py-2 pl-4 pr-12 text-sm font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40 focus-visible:border-main disabled:cursor-not-allowed disabled:opacity-50',
                    className,
                )}
                {...props}
            >
                {children}
            </select>
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-fg"
                aria-hidden="true"
            >
                <path d="m6 9 6 6 6-6" />
            </svg>
        </div>
    ),
);
Select.displayName = 'Select';

export { Select };
