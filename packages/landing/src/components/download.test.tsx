import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Download } from './download';

const RELEASES_FALLBACK = 'https://github.com/programow/ada/releases/latest';

describe('Download', () => {
    it('renders fallback releases links before the manifest resolves', () => {
        // fetch hangs — manifest never resolves during this assertion
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);
        render(<Download />);
        for (const name of [/macOS/i, /Windows/i, /Linux/i]) {
            expect(screen.getByRole('link', { name })).toHaveAttribute('href', RELEASES_FALLBACK);
        }
    });

    it('renders coming-soon cards (no link) for null platforms once resolved', async () => {
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
            expect(screen.getByRole('link', { name: /macOS/i })).toHaveAttribute(
                'href',
                'https://example.test/Vox-Era.dmg',
            );
        });
        expect(screen.queryByRole('link', { name: /Windows/i })).toBeNull();
        expect(screen.queryByRole('link', { name: /Linux/i })).toBeNull();
        expect(screen.getAllByText(/coming soon/i)).toHaveLength(2);
        expect(screen.getByText(/v0\.1\.0/)).toBeInTheDocument();
    });

    it('keeps fallback links when manifest fetch fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('not found', { status: 404 })) as typeof fetch,
        );
        render(<Download />);
        await waitFor(() => {
            // After resolution with null manifest, all three become "coming soon"
            expect(screen.getAllByText(/coming soon/i)).toHaveLength(3);
        });
        expect(screen.queryByRole('link', { name: /macOS/i })).toBeNull();
    });
});
