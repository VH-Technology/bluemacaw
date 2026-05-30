import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toast } from './toast';

describe('<Toast />', () => {
    it('renders nothing when closed', () => {
        render(<Toast open={false} message="hi" onClose={vi.fn()} />);
        expect(screen.queryByTestId('toast')).toBeNull();
    });

    it('renders the message with the success (green) styling by default', () => {
        render(<Toast open message="saved" onClose={vi.fn()} />);
        const el = screen.getByTestId('toast');
        expect(el).toHaveTextContent('saved');
        expect(el.className).toContain('bg-green-500/90');
        expect(el.className).not.toContain('bg-red-500/90');
    });

    it('uses the error (red) styling when variant is "error"', () => {
        render(
            <Toast open variant="error" message="update failed" onClose={vi.fn()} testId="err" />,
        );
        const el = screen.getByTestId('err');
        expect(el).toHaveTextContent('update failed');
        expect(el.className).toContain('bg-red-500/90');
        expect(el.className).not.toContain('bg-green-500/90');
    });

    it('auto-dismisses after the given duration', () => {
        vi.useFakeTimers();
        try {
            const onClose = vi.fn();
            render(<Toast open message="bye" duration={1000} onClose={onClose} />);
            expect(onClose).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1000);
            expect(onClose).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });
});
