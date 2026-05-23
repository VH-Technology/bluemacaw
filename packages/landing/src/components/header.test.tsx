import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Header } from './header';

describe('Header', () => {
    it('points Features at the home-page section, not a same-page fragment', () => {
        // Regression: a bare `#features` resolved against the current path
        // (e.g. /docs/#features) when the header rendered on a sub-page.
        render(<Header />);
        expect(screen.getByRole('link', { name: /features/i })).toHaveAttribute(
            'href',
            '/#features',
        );
    });

    it('links Docs, Privacy, and Changelog to their routes', () => {
        // Next's Link normalizes the trailing slash in the rendered DOM, so
        // match the route with an optional trailing slash rather than exact.
        render(<Header />);
        expect(screen.getByRole('link', { name: /docs/i }).getAttribute('href')).toMatch(
            /^\/docs\/?$/,
        );
        expect(screen.getByRole('link', { name: /privacy/i }).getAttribute('href')).toMatch(
            /^\/privacy\/?$/,
        );
        expect(screen.getByRole('link', { name: /changelog/i }).getAttribute('href')).toMatch(
            /^\/changelog\/?$/,
        );
    });
});
