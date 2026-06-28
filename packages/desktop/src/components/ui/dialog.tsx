import { cn } from '@/lib/utils';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Overlay>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
        ref={ref}
        className={cn(
            'fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            className,
        )}
        {...props}
    />
));
DialogOverlay.displayName = 'DialogOverlay';

const DialogContent = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
    <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
            ref={ref}
            className={cn(
                'fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100vh-2rem)] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-3xl bg-surface p-6 shadow-card-lg focus-visible:outline-none',
                className,
            )}
            {...props}
        >
            {children}
        </DialogPrimitive.Content>
    </DialogPortal>
));
DialogContent.displayName = 'DialogContent';

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('flex flex-col gap-1', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('flex justify-end gap-2', className)} {...props} />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Title
        ref={ref}
        className={cn('text-lg font-extrabold uppercase tracking-widest', className)}
        {...props}
    />
));
DialogTitle.displayName = 'DialogTitle';

const DialogDescription = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description
        ref={ref}
        className={cn('text-sm font-medium', className)}
        {...props}
    />
));
DialogDescription.displayName = 'DialogDescription';

export {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
};
