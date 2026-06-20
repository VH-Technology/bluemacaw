import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTotalDownloads } from './downloads';

function releasesResponse(releases: { assets: { download_count: number }[] }[], status = 200) {
    return new Response(JSON.stringify(releases), { status });
}

describe('fetchTotalDownloads', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sums download_count across every asset of every release', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                releasesResponse([
                    { assets: [{ download_count: 10 }, { download_count: 5 }] },
                    { assets: [{ download_count: 7 }] },
                    { assets: [] },
                ]),
            ) as unknown as typeof fetch,
        );
        await expect(fetchTotalDownloads()).resolves.toBe(22);
    });

    it('returns 0 when there are releases but no downloadable assets', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => releasesResponse([{ assets: [] }])) as unknown as typeof fetch,
        );
        await expect(fetchTotalDownloads()).resolves.toBe(0);
    });

    it('returns null on a non-ok response (e.g. rate limit)', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => releasesResponse([], 403)) as unknown as typeof fetch,
        );
        await expect(fetchTotalDownloads()).resolves.toBeNull();
    });

    it('returns null when the fetch throws', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('network down');
            }) as unknown as typeof fetch,
        );
        await expect(fetchTotalDownloads()).resolves.toBeNull();
    });

    it('returns null when the payload is not an array', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 200 }),
            ) as unknown as typeof fetch,
        );
        await expect(fetchTotalDownloads()).resolves.toBeNull();
    });
});
