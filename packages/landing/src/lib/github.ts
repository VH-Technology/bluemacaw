export interface Release {
    tag: string;
    name: string;
    body: string;
    publishedAt: string;
    htmlUrl: string;
}

interface GithubRelease {
    tag_name: string;
    name: string;
    body: string;
    published_at: string;
    html_url: string;
    draft?: boolean;
}

function toReleases(data: GithubRelease[]): Release[] {
    return data
        .filter((r) => !r.draft)
        .map((r) => ({
            tag: r.tag_name,
            name: r.name,
            body: r.body,
            publishedAt: r.published_at,
            htmlUrl: r.html_url,
        }));
}

/**
 * Primary source: the live GitHub REST API. Returns `Release[]` on success
 * (including an empty array for a repo with no releases), or `null` when the
 * call fails so the caller can fall back. Authenticates with the Actions
 * `GITHUB_TOKEN` when present (5000 req/hr vs the 60 req/hr unauthenticated
 * ceiling) and retries once on a transient status.
 */
async function fetchReleasesFromApi(
    repo: string,
    headers: Record<string, string>,
): Promise<Release[] | null> {
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100`;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(url, { headers });
            if (res.ok) return toReleases((await res.json()) as GithubRelease[]);
            // A 404 (wrong repo path) won't fix itself; only retry transient
            // rate-limit / server errors.
            const transient = res.status === 403 || res.status === 429 || res.status >= 500;
            if (!transient) return null;
        } catch {
            // Network error — fall through to the retry.
        }
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return null;
}

/**
 * Fallback source: the `changelog.json` asset the release pipeline attaches
 * to every release (see `.github/workflows/release.yml`). It's served via
 * the `releases/latest/download/` CDN redirect, which is NOT subject to the
 * rate-limited JSON API — so it resolves even when the API 403s on a shared
 * CI runner IP. Already in `Release[]` shape; parsed defensively. Returns
 * `null` if the asset is missing or malformed.
 */
async function fetchReleasesFromFallback(repo: string): Promise<Release[] | null> {
    const url = `https://github.com/${repo}/releases/latest/download/changelog.json`;
    try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) return null;
        const data = await res.json();
        if (!Array.isArray(data)) return null;
        return data
            .filter((r): r is Partial<Release> => typeof r?.tag === 'string')
            .map((r) => ({
                tag: r.tag as string,
                name: r.name ?? (r.tag as string),
                body: r.body ?? '',
                publishedAt: r.publishedAt ?? '',
                htmlUrl: r.htmlUrl ?? `https://github.com/${repo}/releases`,
            }));
    } catch {
        return null;
    }
}

/**
 * Fetch a repo's releases for the changelog page (a statically-exported
 * server component, so this runs at build time).
 *
 * Tries the live GitHub API first; if that fails (rate limit, private repo,
 * network), falls back to the pipeline-generated `changelog.json` release
 * asset. Returns `[]` only when both sources fail or the repo genuinely has
 * no releases — preserving the "No releases yet" empty state.
 */
export async function fetchReleases(repo: string): Promise<Release[]> {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const fromApi = await fetchReleasesFromApi(repo, headers);
    if (fromApi) return fromApi;

    const fromFallback = await fetchReleasesFromFallback(repo);
    return fromFallback ?? [];
}
