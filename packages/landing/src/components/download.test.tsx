import { logDownloadEvent } from '@/lib/firebase';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Download } from './download';

vi.mock('@/lib/firebase', () => ({
    logDownloadEvent: vi.fn(),
    initFirebase: vi.fn(),
}));

const RELEASES_FALLBACK = 'https://github.com/VH-Technology/bluemacaw/releases/latest';

describe('Download', () => {
    it('renders fallback download buttons before the manifest resolves', () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);
        render(<Download />);
        for (const name of [
            'Download bluemacaw for macOS',
            'Download bluemacaw for Windows',
            'Download bluemacaw for Linux',
            'Download bluemacaw for Linux on ARM64',
        ]) {
            expect(screen.getByRole('link', { name })).toHaveAttribute('href', RELEASES_FALLBACK);
        }
    });

    it('surfaces a separate ARM64 download when the manifest exposes an aarch64 build', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            tag_name: 'v0.2.0',
                            assets: [
                                {
                                    name: 'bluemacaw_0.2.0_amd64.AppImage',
                                    browser_download_url: 'https://example.test/amd64.AppImage',
                                },
                                {
                                    name: 'bluemacaw_0.2.0_aarch64.AppImage',
                                    browser_download_url: 'https://example.test/aarch64.AppImage',
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
                screen.getByRole('link', { name: 'Download bluemacaw for Linux' }),
            ).toHaveAttribute('href', 'https://example.test/amd64.AppImage');
        });
        expect(
            screen.getByRole('link', { name: 'Download bluemacaw for Linux on ARM64' }),
        ).toHaveAttribute('href', 'https://example.test/aarch64.AppImage');
        expect(screen.queryByText(/amd64 only/i)).toBeNull();
    });

    it('each platform card exposes a Setup guide link to /docs/#install-<os>', () => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})) as unknown as typeof fetch);
        render(<Download />);
        const guides = screen.getAllByRole('link', { name: /setup guide/i });
        const hrefs = guides.map((g) => g.getAttribute('href'));
        expect(hrefs).toEqual(
            expect.arrayContaining([
                '/docs/#install-macos',
                '/docs/#install-windows',
                '/docs/#install-linux',
            ]),
        );
    });

    it('renders coming-soon cards (no download link) for null platforms once resolved', async () => {
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
        expect(screen.queryByRole('link', { name: /download bluemacaw for linux/i })).toBeNull();
        expect(screen.getAllByText(/coming soon/i)).toHaveLength(2);
        // Version is intentionally not shown on the download cards.
        expect(screen.queryByText(/v0\.1\.0/)).toBeNull();
    });

    it('keeps the coming-soon Setup guide link visible even when the download is unavailable', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('not found', { status: 404 })) as typeof fetch,
        );
        render(<Download />);
        await waitFor(() => {
            expect(screen.getAllByText(/coming soon/i)).toHaveLength(3);
        });
        // 4 setup-guide links total: the section-header "Full setup guide" + one per card.
        expect(screen.getAllByRole('link', { name: /setup guide/i })).toHaveLength(4);
        expect(screen.getAllByRole('link', { name: /^read setup guide/i })).toHaveLength(3);
        // ...and zero download buttons.
        expect(screen.queryByRole('link', { name: /download bluemacaw for/i })).toBeNull();
    });

    it('calls logDownloadEvent when a download button is clicked', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            tag_name: 'v0.2.0',
                            assets: [
                                {
                                    name: 'bluemacaw_0.2.0_x64.msi',
                                    browser_download_url: 'https://example.test/installer.msi',
                                },
                            ],
                        }),
                        { status: 200 },
                    ),
            ) as typeof fetch,
        );

        const { fireEvent } = await import('@testing-library/react');
        render(<Download />);

        const downloadButton = await screen.findByRole('link', {
            name: 'Download bluemacaw for Windows',
        });
        fireEvent.click(downloadButton);

        expect(logDownloadEvent).toHaveBeenCalledWith(
            'Windows',
            'https://example.test/installer.msi',
            'Download',
        );
    });
});
