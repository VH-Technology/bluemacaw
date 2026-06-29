import type { MetadataRoute } from 'next';

const SITE_URL = 'https://bluemacaw.com';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
    const lastModified = new Date();
    return [
        { url: `${SITE_URL}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
        { url: `${SITE_URL}/docs/`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
        { url: `${SITE_URL}/privacy/`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
        { url: `${SITE_URL}/changelog/`, lastModified, changeFrequency: 'weekly', priority: 0.6 },
    ];
}
