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

/**
 * Fetch a repo's releases for the changelog page. This runs at **build time**
 * (the changelog is a statically-exported server component), on a CI runner
 * whose IP is shared and heavily rate-limited against the unauthenticated
 * GitHub API — 60 req/hr/IP. When a build trips that ceiling the call 403s
 * and the changelog would silently ship as "No releases yet" (exactly the bug
 * this fixes).
 *
 * Mitigations:
 *  - Authenticate with the Actions `GITHUB_TOKEN` when present (5000 req/hr).
 *    `pages-deploy.yml` passes it into the build env.
 *  - Retry once on a transient status (403/429/5xx) so a momentary blip
 *    doesn't blank the page.
 *  - Filter drafts (authenticated requests can return them).
 *
 * Falls back to `[]` only as a last resort, preserving the "No releases yet"
 * empty state for a genuinely release-less repo.
 */
export async function fetchReleases(repo: string): Promise<Release[]> {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const url = `https://api.github.com/repos/${repo}/releases?per_page=100`;

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await fetch(url, { headers });
            if (res.ok) {
                const data = (await res.json()) as GithubRelease[];
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
            // A 404 (wrong repo path) won't fix itself; only retry transient
            // rate-limit / server errors.
            const transient = res.status === 403 || res.status === 429 || res.status >= 500;
            if (!transient) return [];
        } catch {
            // Network error — fall through to the retry.
        }
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return [];
}
