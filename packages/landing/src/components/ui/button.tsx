import { cn } from '@/lib/utils';
import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

const buttonVariants = cva(
    'inline-flex items-center justify-center whitespace-nowrap rounded-pill font-bold tracking-wide transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
    {
        variants: {
            variant: {
                default:
                    'bg-main text-main-foreground shadow-card hover:shadow-card-lg active:translate-y-px',
                outline:
                    'border border-border bg-surface text-fg hover:bg-muted active:translate-y-px',
                ghost: 'text-fg hover:bg-muted',
                destructive:
                    'bg-brand-coral text-white shadow-card hover:shadow-card-lg active:translate-y-px',
            },
            size: {
                default: 'h-10 px-5 py-2 text-sm',
                sm: 'h-8 px-4 text-xs',
                lg: 'h-12 px-7 text-base',
                xl: 'h-14 px-8 text-base',
                icon: 'h-10 w-10 p-0',
            },
        },
        defaultVariants: { variant: 'default', size: 'default' },
    },
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : 'button';
        return (
            <Comp
                ref={ref}
                className={cn(buttonVariants({ variant, size, className }))}
                {...props}
            />
        );
    },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
