import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DocsPage from './page';

describe('Docs page', () => {
    it('renders an install section + matching TOC entry for each OS', () => {
        const { container } = render(<DocsPage />);
        for (const id of ['install-macos', 'install-windows']) {
            // Section anchor exists (target of both deep links and TOC).
            expect(container.querySelector(`#${id}`)).not.toBeNull();
            // TOC has a link pointing at it.
            expect(container.querySelector(`a[href="#${id}"]`)).not.toBeNull();
        }
    });

    it('cross-links to the GitHub providers doc', () => {
        render(<DocsPage />);
        expect(screen.getByRole('link', { name: /docs\/providers\.md/i })).toHaveAttribute(
            'href',
            'https://github.com/VH-Technology/bluemacaw/blob/main/docs/providers.md',
        );
    });

    it('mentions macOS Accessibility requirement in troubleshooting', () => {
        render(<DocsPage />);
        expect(screen.getByText(/accessibility permission required/i)).toBeInTheDocument();
    });
});
