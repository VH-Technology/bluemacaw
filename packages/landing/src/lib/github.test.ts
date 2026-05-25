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

    it('returns empty array when both the API and the fallback asset fail', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('not found', { status: 404 })) as typeof fetch,
        );
        const releases = await fetchReleases('programow/ada');
        expect(releases).toEqual([]);
    });

    it('falls back to the changelog.json release asset when the API fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (url.startsWith('https://api.github.com/')) {
                    // API unavailable (404/private/rate-limited).
                    return new Response('nope', { status: 404 });
                }
                if (url.includes('releases/latest/download/changelog.json')) {
                    return new Response(
                        JSON.stringify([
                            {
                                tag: 'v2.0.0',
                                name: 'v2.0.0',
                                body: 'from the pipeline fallback',
                                publishedAt: '2026-03-01T00:00:00Z',
                                htmlUrl: 'https://github.com/x/y/releases/tag/v2.0.0',
                            },
                        ]),
                        { status: 200 },
                    );
                }
                return new Response('not found', { status: 404 });
            }) as typeof fetch,
        );
        const releases = await fetchReleases('programow/ada');
        expect(releases).toHaveLength(1);
        expect(releases[0]?.tag).toBe('v2.0.0');
        expect(releases[0]?.body).toBe('from the pipeline fallback');
    });

    it('does not hit the fallback when the API succeeds (even with zero releases)', async () => {
        const spy = vi.fn(async () => new Response('[]', { status: 200 }));
        vi.stubGlobal('fetch', spy as unknown as typeof fetch);
        const releases = await fetchReleases('programow/ada');
        expect(releases).toEqual([]);
        // Only the API call — no fallback fetch.
        expect(spy).toHaveBeenCalledTimes(1);
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
