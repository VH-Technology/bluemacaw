import { describe, expect, it, vi } from 'vitest';
import { fetchReleases } from './github';

vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
        if (url.includes('/releases')) {
            return new Response(
                JSON.stringify([
                    {
                        tag_name: 'v1.0.0',
                        name: 'v1.0.0',
                        body: 'first release',
                        published_at: '2026-01-01T00:00:00Z',
                        html_url: 'https://github.com/x/y/releases/tag/v1.0.0',
                    },
                ]),
                { status: 200 },
            );
        }
        return new Response('[]', { status: 200 });
    }) as typeof fetch,
);

describe('fetchReleases', () => {
    it('returns parsed releases', async () => {
        const releases = await fetchReleases('programow/ada');
        expect(releases).toHaveLength(1);
        expect(releases[0]?.tag).toBe('v1.0.0');
    });

    it('returns empty array when fetch fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('not found', { status: 404 })) as typeof fetch,
        );
        const releases = await fetchReleases('programow/ada');
        expect(releases).toEqual([]);
    });
});
