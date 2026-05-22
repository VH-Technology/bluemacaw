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

    it('sends an Authorization header when GITHUB_TOKEN is set', async () => {
        const spy = vi.fn((_url: string, _init?: RequestInit) =>
            Promise.resolve(new Response('[]', { status: 200 })),
        );
        vi.stubGlobal('fetch', spy as unknown as typeof fetch);
        vi.stubEnv('GITHUB_TOKEN', 'tok_abc123');

        await fetchReleases('programow/ada');

        const headers = (spy.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer tok_abc123');
        vi.unstubAllEnvs();
    });

    it('omits the Authorization header when no token is present', async () => {
        const spy = vi.fn((_url: string, _init?: RequestInit) =>
            Promise.resolve(new Response('[]', { status: 200 })),
        );
        vi.stubGlobal('fetch', spy as unknown as typeof fetch);
        vi.stubEnv('GITHUB_TOKEN', '');
        vi.stubEnv('GH_TOKEN', '');

        await fetchReleases('programow/ada');

        const headers = (spy.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
        expect(headers.Authorization).toBeUndefined();
        vi.unstubAllEnvs();
    });

    it('filters out draft releases', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify([
                            {
                                tag_name: 'v1.0.0',
                                name: 'v1.0.0',
                                body: 'shipped',
                                published_at: '2026-01-01T00:00:00Z',
                                html_url: 'https://github.com/x/y/releases/tag/v1.0.0',
                                draft: false,
                            },
                            {
                                tag_name: 'v1.1.0-draft',
                                name: 'wip',
                                body: 'not ready',
                                published_at: '2026-02-01T00:00:00Z',
                                html_url: 'https://github.com/x/y/releases/tag/v1.1.0-draft',
                                draft: true,
                            },
                        ]),
                        { status: 200 },
                    ),
            ) as typeof fetch,
        );
        const releases = await fetchReleases('programow/ada');
        expect(releases).toHaveLength(1);
        expect(releases[0]?.tag).toBe('v1.0.0');
    });
});
