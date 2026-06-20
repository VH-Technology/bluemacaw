'use client';

import { fetchTotalDownloads } from '@/lib/downloads';
import { useEffect, useState } from 'react';

/**
 * Live total-downloads stat for the download section. Fetches GitHub
 * release-asset download counts client-side (like the Download component
 * does for the binary URLs) and renders nothing until a positive count
 * resolves — so a fetch failure or a not-yet-released project shows no
 * broken "0 downloads" line.
 */
export function DownloadCount() {
    const [count, setCount] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchTotalDownloads().then((n) => {
            if (!cancelled) setCount(n);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    if (count === null || count <= 0) return null;

    return (
        <p className="mt-2 text-sm font-semibold text-main">
            {new Intl.NumberFormat('en-US').format(count)} downloads and counting
        </p>
    );
}
