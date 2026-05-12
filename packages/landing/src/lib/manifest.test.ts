import { describe, expect, it, vi } from 'vitest';
import { fetchManifest } from './manifest';

function apiResponse(assets: { name: string; browser_download_url: string }[], tag = 'v0.1.0') {
    return new Response(JSON.stringify({ tag_name: tag, assets }), { status: 200 });
}

describe('fetchManifest', () => {
    it('maps GitHub release assets to platform download URLs', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                apiResponse([
                    {
                        name: 'Vox.Era_0.1.0_universal.dmg',
                        browser_download_url:
                            'https://github.com/programow/ada/releases/download/v0.1.0/Vox.Era_0.1.0_universal.dmg',
                    },
                    {
                        name: 'Vox.Era_universal.app.tar.gz',
                        browser_download_url:
                            'https://github.com/programow/ada/releases/download/v0.1.0/Vox.Era_universal.app.tar.gz',
                    },
                ]),
            ) as typeof fetch,
        );
        const manifest = await fetchManifest();
        expect(manifest?.version).toBe('0.1.0');
        expect(manifest?.mac).toContain('.dmg');
        expect(manifest?.win).toBeNull();
        expect(manifest?.linux).toBeNull();
    });

    it('returns URLs for windows (.msi) and linux (.AppImage) when present', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                apiResponse([
                    {
                        name: 'Vox.Era_0.2.0_x64.msi',
                        browser_download_url: 'https://example.test/v0.2.0/Vox.Era_0.2.0_x64.msi',
                    },
                    {
                        name: 'vox-era_0.2.0_amd64.AppImage',
                        browser_download_url:
                            'https://example.test/v0.2.0/vox-era_0.2.0_amd64.AppImage',
                    },
                ]),
            ) as typeof fetch,
        );
        const manifest = await fetchManifest();
        expect(manifest?.win).toContain('.msi');
        expect(manifest?.linux).toContain('.AppImage');
        expect(manifest?.mac).toBeNull();
    });

    it('returns null when the response is not OK', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('not found', { status: 404 })) as typeof fetch,
        );
        expect(await fetchManifest()).toBeNull();
    });

    it('returns null when fetch throws', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('network down');
            }) as typeof fetch,
        );
        expect(await fetchManifest()).toBeNull();
    });
});
