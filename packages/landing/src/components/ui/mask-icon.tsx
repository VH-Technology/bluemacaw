import { cn } from '@/lib/utils';
import type { CSSProperties } from 'react';

export interface MaskIconProps {
    /** Path to a monochrome SVG in /public, e.g. "/icons/macos.svg". */
    src: string;
    /** Sizing / color utility classes. Color comes from `currentColor`. */
    className?: string;
    'data-testid'?: string;
}

/**
 * Renders a monochrome SVG (loaded from /public) as a CSS mask painted with
 * the element's `currentColor`. This lets icon artwork live in standalone
 * .svg files while preserving `currentColor` theming — a plain <img> can't
 * inherit the surrounding text color, so a mask is the faithful way to move
 * these out of the components without changing how they look.
 */
export function MaskIcon({ src, className, 'data-testid': testId }: MaskIconProps) {
    const style: CSSProperties = {
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        // Mask by the SVG's alpha coverage (the icons paint with currentColor,
        // which renders opaque in isolation) rather than luminance.
        maskMode: 'alpha',
    };
    return (
        <span
            aria-hidden="true"
            data-testid={testId}
            className={cn('inline-block bg-current', className)}
            style={style}
        />
    );
}
