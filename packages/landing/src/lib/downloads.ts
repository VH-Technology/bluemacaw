// Total GitHub release-asset downloads across all published releases.
//
// Same CORS rationale as manifest.ts: we hit api.github.com (CORS-friendly)
// rather than a release-download asset URL. This counts downloads of the
// binaries attached to GitHub Releases (DMG / MSI / AppImage / .deb / .rpm).
// It does NOT count installs via the apt/dnf repos or any mirror, so treat
// it as a floor, not an exact install count.
export const RELEASES_LIST_API_URL =
    'https://api.github.com/repos/VH-Technology/bluemacaw/releases?per_page=100';

interface ReleaseAssetCount {
    download_count?: number;
}

interface ReleaseListEntry {
    assets?: ReleaseAssetCount[];
}

/**
 * Sum `download_count` over every asset of every release. Returns `null`
 * on any failure (network error, rate limit, unexpected shape) so callers
 * can render a graceful fallback instead of a broken number.
 */
export async function fetchTotalDownloads(): Promise<number | null> {
    try {
        const res = await fetch(RELEASES_LIST_API_URL, {
            headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as ReleaseListEntry[];
        if (!Array.isArray(data)) return null;
        let total = 0;
        for (const release of data) {
            for (const asset of release.assets ?? []) {
                if (typeof asset.download_count === 'number') {
                    total += asset.download_count;
                }
            }
        }
        return total;
    } catch {
        return null;
    }
}
