'use client';

import { type DownloadManifest, fetchManifest } from '@/lib/manifest';
import { useEffect, useState } from 'react';

const RELEASES_FALLBACK = 'https://github.com/programow/ada/releases/latest';

function MacIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" fill="currentColor">
            <path d="M16.6 13.4c0-2.7 2.2-4 2.3-4-1.3-1.9-3.2-2.1-3.9-2.2-1.7-.2-3.2 1-4 1-.8 0-2.1-1-3.5-1-1.8 0-3.5 1-4.4 2.7-1.9 3.3-.5 8.1 1.3 10.7.9 1.3 2 2.7 3.4 2.6 1.4-.1 1.9-.9 3.6-.9 1.6 0 2.1.9 3.5.9 1.4 0 2.4-1.3 3.3-2.6.7-1 1.2-2 1.5-3.1-2.3-.9-3.1-3.4-3.1-4.1zM13.7 5.5c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.5-.7.8-1.3 2-1.1 3.2 1.2.1 2.3-.6 3-1.4z" />
        </svg>
    );
}

function WindowsIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" fill="currentColor">
            <path d="M3 5.6 10.4 4.6V11.4H3V5.6zm0 12.8V12.6h7.4v6.4L3 18.4zM11.6 11.4V4.4L21 3v8.4h-9.4zm0 8L21 21V12.6h-9.4v6.8z" />
        </svg>
    );
}

function LinuxIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" fill="currentColor">
            <path d="M12 2c-2.6 0-4.5 2.2-4.5 5 0 1.7.6 3 1.3 4-.5.6-1.3 1.8-1.9 3.2-.7 1.6-1.4 3.7-1.4 5.1 0 .9.4 1.6 1 2 .6.4 1.4.5 2.1.5h.1c.4.4.9.7 1.5.8.6.1 1.2.1 1.8 0 .6-.1 1.1-.4 1.5-.8h.1c.7 0 1.5-.1 2.1-.5.6-.4 1-1.1 1-2 0-1.4-.7-3.5-1.4-5.1-.6-1.4-1.4-2.6-1.9-3.2.7-1 1.3-2.3 1.3-4 0-2.8-1.9-5-4.5-5zm-1.3 4c.4 0 .7.5.7 1s-.3 1-.7 1c-.4 0-.7-.5-.7-1s.3-1 .7-1zm2.6 0c.4 0 .7.5.7 1s-.3 1-.7 1c-.4 0-.7-.5-.7-1s.3-1 .7-1z" />
        </svg>
    );
}

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

    return (
        <section id="download" className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-10 text-center">
                <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
                    Download for your platform
                </h2>
                <p className="mt-3 text-muted-foreground">
                    Free, open source, no account required.
                </p>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                <PlatformCard
                    name="macOS"
                    detail="Signed + notarized DMG"
                    href={macHref}
                    icon={<MacIcon />}
                    version={manifest?.version}
                />
                <PlatformCard
                    name="Windows"
                    detail="Unsigned NSIS installer"
                    href={winHref}
                    icon={<WindowsIcon />}
                />
                <PlatformCard
                    name="Linux"
                    detail="AppImage, deb, rpm — see /install-linux"
                    href={linuxHref}
                    icon={<LinuxIcon />}
                />
            </div>
        </section>
    );
}

interface PlatformCardProps {
    name: string;
    detail: string;
    href: string | null;
    icon: React.ReactNode;
    version?: string;
}

function PlatformCard({ name, detail, href, icon, version }: PlatformCardProps) {
    if (href === null) {
        return (
            <div
                aria-disabled
                className="flex flex-col gap-3 rounded-2xl bg-surface p-7 shadow-card-lg opacity-60"
            >
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-main/10 text-main">
                    {icon}
                </span>
                <div className="text-xl font-bold tracking-tight">{name}</div>
                <div className="text-sm text-muted-foreground">Coming soon</div>
            </div>
        );
    }
    return (
        <a
            href={href}
            className="group flex flex-col gap-3 rounded-2xl bg-surface p-7 shadow-card-lg transition-all hover:-translate-y-1 hover:shadow-pop"
        >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-main/10 text-main">
                {icon}
            </span>
            <div className="text-xl font-bold tracking-tight">{name}</div>
            <div className="text-sm text-muted-foreground">{detail}</div>
            {version ? (
                <div className="text-xs text-muted-foreground opacity-70">v{version}</div>
            ) : null}
            <span className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-main">
                Download{' '}
                <span
                    aria-hidden="true"
                    className="transition-transform group-hover:translate-x-0.5"
                >
                    →
                </span>
            </span>
        </a>
    );
}
