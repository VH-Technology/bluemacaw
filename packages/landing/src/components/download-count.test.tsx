import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadCount } from './download-count';

function releasesResponse(releases: { assets: { download_count: number }[] }[], status = 200) {
    return new Response(JSON.stringify(releases), { status });
}

describe('DownloadCount', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders the formatted total once the count resolves', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                releasesResponse([{ assets: [{ download_count: 1234 }, { download_count: 66 }] }]),
            ) as unknown as typeof fetch,
        );
        render(<DownloadCount />);
        await waitFor(() => {
            expect(screen.getByText(/1,300 downloads and counting/)).toBeInTheDocument();
        });
    });

    it('renders nothing when the fetch fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => releasesResponse([], 403)) as unknown as typeof fetch,
        );
        let container!: HTMLElement;
        await act(async () => {
            container = render(<DownloadCount />).container;
        });
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when there are zero downloads', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => releasesResponse([{ assets: [] }])) as unknown as typeof fetch,
        );
        let container!: HTMLElement;
        await act(async () => {
            container = render(<DownloadCount />).container;
        });
        expect(container).toBeEmptyDOMElement();
    });
});
