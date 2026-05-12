export interface DownloadManifest {
    version: string;
    mac: string | null;
    win: string | null;
    linux: string | null;
}

// We hit the API (not the releases/latest/download/latest.json asset URL)
// because github.com's release-download redirect doesn't set CORS headers,
// so browser fetch() blocks it. api.github.com is CORS-friendly.
export const RELEASES_API_URL = 'https://api.github.com/repos/programow/ada/releases/latest';

interface ReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface ReleaseResponse {
    tag_name: string;
    assets: ReleaseAsset[];
}

export async function fetchManifest(): Promise<DownloadManifest | null> {
    try {
        const res = await fetch(RELEASES_API_URL, {
            headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as ReleaseResponse;
        const find = (re: RegExp) =>
            data.assets.find((a) => re.test(a.name))?.browser_download_url ?? null;
        return {
            version: data.tag_name.replace(/^v/, ''),
            mac: find(/\.dmg$/),
            win: find(/\.msi$|-setup\.exe$/),
            linux: find(/\.AppImage$/),
        };
    } catch {
        return null;
    }
}
