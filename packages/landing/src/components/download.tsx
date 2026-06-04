'use client';

import { MaskIcon } from '@/components/ui/mask-icon';
import { type DownloadManifest, fetchManifest } from '@/lib/manifest';
import { useEffect, useState } from 'react';

const RELEASES_FALLBACK = 'https://github.com/VH-Technology/bluemacaw/releases/latest';

export function Download() {
    const [manifest, setManifest] = useState<DownloadManifest | null>(null);
    const [resolved, setResolved] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetchManifest().then((m) => {
            if (cancelled) return;
            setManifest(m);
            setResolved(true);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const macHref = manifest?.mac ?? (resolved ? null : RELEASES_FALLBACK);
    const winHref = manifest?.win ?? (resolved ? null : RELEASES_FALLBACK);
    const linuxHref = manifest?.linux ?? (resolved ? null : RELEASES_FALLBACK);
    const linuxArm64Href = manifest?.linuxArm64 ?? (resolved ? null : RELEASES_FALLBACK);

    return (
        <section id="download" className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-10 text-center">
                <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
                    Download for your platform
                </h2>
                <p className="mt-3 text-muted-foreground">
                    Free, open source, no account required.{' '}
                    <a href="/docs/" className="font-semibold text-main hover:underline">
                        Full setup guide →
                    </a>
                </p>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                <PlatformCard
                    name="macOS"
                    detail="Signed + notarized DMG"
                    href={macHref}
                    docsHref="/docs/#install-macos"
                    icon={<MaskIcon src="/icons/macos.svg" className="h-7 w-7" />}
                />
                <PlatformCard
                    name="Windows"
                    detail="Unsigned NSIS installer"
                    href={winHref}
                    docsHref="/docs/#install-windows"
                    icon={<MaskIcon src="/icons/windows.svg" className="h-7 w-7" />}
                    tags={['Beta']}
                />
                <PlatformCard
                    name="Linux"
                    detail="AppImage, .deb, .rpm — amd64 + arm64"
                    href={linuxHref}
                    altHref={linuxArm64Href}
                    altLabel="ARM64"
                    docsHref="/docs/#install-linux"
                    icon={<MaskIcon src="/icons/linux.svg" className="h-7 w-7" />}
                    tags={['Beta']}
                />
            </div>
        </section>
    );
}

interface PlatformCardProps {
    name: string;
    detail: string;
    href: string | null;
    docsHref: string;
    icon: React.ReactNode;
    /** Small support-status pills shown next to the platform name (e.g. "Beta"). */
    tags?: readonly string[];
    /** Optional secondary-architecture download (e.g. Linux ARM64). */
    altHref?: string | null;
    /** Label for the secondary-architecture download (e.g. "ARM64"). */
    altLabel?: string;
}

function PlatformCard({
    name,
    detail,
    href,
    docsHref,
    icon,
    tags,
    altHref,
    altLabel,
}: PlatformCardProps) {
    const comingSoon = href === null;
    return (
        <div
            aria-disabled={comingSoon || undefined}
            className={`flex flex-col gap-3 rounded-2xl bg-surface p-7 shadow-card-lg ${comingSoon ? 'opacity-60' : ''}`}
        >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-main/10 text-main">
                {icon}
            </span>
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xl font-bold tracking-tight">{name}</span>
                {tags?.map((tag) => (
                    <span
                        key={tag}
                        className="inline-flex items-center rounded-pill bg-brand-yellow px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-navy"
                    >
                        {tag}
                    </span>
                ))}
            </div>
            <div className="text-sm text-muted-foreground">
                {comingSoon ? 'Coming soon' : detail}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
                {comingSoon ? null : (
                    <a
                        href={href}
                        aria-label={`Download bluemacaw for ${name}`}
                        className="inline-flex items-center gap-1.5 rounded-pill bg-main px-4 py-2 text-sm font-bold text-main-foreground shadow-card transition-transform hover:-translate-y-0.5"
                    >
                        Download
                        <span aria-hidden="true">↓</span>
                    </a>
                )}
                {!comingSoon && altHref && altLabel ? (
                    <a
                        href={altHref}
                        aria-label={`Download bluemacaw for ${name} on ${altLabel}`}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-main hover:underline"
                    >
                        {altLabel}
                        <span aria-hidden="true">↓</span>
                    </a>
                ) : null}
                <a
                    href={docsHref}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-main hover:underline"
                >
                    {comingSoon ? 'Read setup guide' : 'Setup guide'}
                    <span aria-hidden="true">→</span>
                </a>
            </div>
        </div>
    );
}
