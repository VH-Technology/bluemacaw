import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Footer } from './footer';

describe('Footer', () => {
    it('shows the GitHub link', () => {
        render(<Footer version="0.1.0" />);
        const link = screen.getByRole('link', { name: /github/i });
        expect(link).toHaveAttribute('href', expect.stringContaining('programow/vox-era'));
    });

    it('shows the version', () => {
        render(<Footer version="1.2.3" />);
        expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument();
    });

    it('shows the Joe the bird brand', () => {
        render(<Footer version="0.0.0" />);
        expect(screen.getByText(/joe the bird/i)).toBeInTheDocument();
    });
});
