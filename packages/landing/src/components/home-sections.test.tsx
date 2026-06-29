import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Demo } from './demo';
import { Download } from './download';
import { Features } from './features';
import { PrivacyTeaser } from './privacy-teaser';
import { ProvidersGrid } from './providers-grid';
import { SEO_FAQS, SeoFaq } from './seo-faq';

describe('home sections', () => {
    it('Demo renders an accessible recording-demo region', () => {
        // initialPhase disables the auto-cycle so no timers run during the test.
        render(<Demo initialPhase="idle" />);
        expect(screen.getByRole('region', { name: /recording demo/i })).toBeInTheDocument();
    });

    it('Features renders all 6 cards', () => {
        render(<Features />);
        expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(6);
    });

    it('ProvidersGrid renders all 10 provider names', () => {
        render(<ProvidersGrid />);
        for (const name of [
            'AssemblyAI',
            'Azure OpenAI',
            'Deepgram',
            'ElevenLabs',
            'Fal',
            'Gladia',
            'Groq',
            'Grok (xAI)',
            'OpenAI',
            'Rev.ai',
        ]) {
            expect(screen.getByText(name)).toBeInTheDocument();
        }
    });

    it('PrivacyTeaser links to /privacy/', () => {
        render(<PrivacyTeaser />);
        expect(screen.getByRole('link', { name: /privacy story/i })).toHaveAttribute(
            'href',
            '/privacy/',
        );
    });

    it('SeoFaq renders the SEO FAQ answers', () => {
        render(<SeoFaq />);
        expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(SEO_FAQS.length);
        expect(screen.getByText(/free software licensed under Apache 2\.0/i)).toBeInTheDocument();
    });

    it('Download resolves manifest and renders a mac download with coming-soon for null platforms', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            tag_name: 'v0.1.0',
                            assets: [
                                {
                                    name: 'Vox.Era_0.1.0_universal.dmg',
                                    browser_download_url: 'https://example.test/Vox-Era.dmg',
                                },
                            ],
                        }),
                        { status: 200 },
                    ),
            ) as typeof fetch,
        );
        render(<Download />);
        await waitFor(() => {
            expect(
                screen.getByRole('link', { name: /download bluemacaw for macos/i }),
            ).toHaveAttribute('href', 'https://example.test/Vox-Era.dmg');
        });
        expect(screen.queryByRole('link', { name: /download bluemacaw for windows/i })).toBeNull();
        expect(screen.getAllByText(/coming soon/i)).toHaveLength(1);
        // 3 setup-guide links total: the section-header "Full setup guide" + one per card.
        expect(screen.getAllByRole('link', { name: /setup guide/i })).toHaveLength(3);
    });
});
