import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Footer } from './footer';

describe('Footer', () => {
    it('shows the GitHub link', () => {
        render(<Footer version="0.1.0" />);
        const link = screen.getByRole('link', { name: /github/i });
        expect(link).toHaveAttribute('href', expect.stringContaining('VH-Technology/bluemacaw'));
    });

    it('shows the version', () => {
        render(<Footer version="1.2.3" />);
        expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument();
    });

    it('shows the bluemacaw brand', () => {
        render(<Footer version="0.0.0" />);
        expect(screen.getByText(/bluemacaw/i)).toBeInTheDocument();
    });

    it('links to the companies that run bluemacaw', () => {
        render(<Footer version="0.0.0" />);
        const programow = screen.getByRole('link', { name: /programow/i });
        expect(programow).toHaveAttribute('href', expect.stringContaining('programow.com'));
        const avinu = screen.getByRole('link', { name: /avinu/i });
        expect(avinu).toHaveAttribute('href', expect.stringContaining('avinu.tech'));
    });

    it('shows both company CNPJs', () => {
        render(<Footer version="0.0.0" />);
        expect(screen.getByText(/43\.397\.150\/0001-93/)).toBeInTheDocument();
        expect(screen.getByText(/42\.184\.742\/0001-64/)).toBeInTheDocument();
    });
});
