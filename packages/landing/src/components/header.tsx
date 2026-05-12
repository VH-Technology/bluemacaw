import Link from 'next/link';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';

const NAV_LINKS = [
    { href: '#features', label: 'Features' },
    { href: '/privacy/', label: 'Privacy' },
    { href: '/changelog/', label: 'Changelog' },
] as const;

export function Header() {
    return (
        <header className="sticky top-0 z-30 border-b border-border bg-bg/70 backdrop-blur-md">
            <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
                <Link
                    href="/"
                    className="group flex items-center gap-2.5"
                    aria-label="Joe the bird — home"
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/logo.svg"
                        alt=""
                        aria-hidden="true"
                        className="h-8 w-8 transition-transform group-hover:rotate-[-6deg]"
                    />
                    <span className="text-base font-bold tracking-tight text-fg">Joe the bird</span>
                </Link>

                <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
                    {NAV_LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="rounded-pill px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-fg"
                        >
                            {link.label}
                        </Link>
                    ))}
                </nav>

                <div className="flex items-center gap-2">
                    <ThemeToggle />
                    <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex">
                        <a
                            href="https://github.com/programow/vox-era"
                            target="_blank"
                            rel="noreferrer"
                        >
                            GitHub
                        </a>
                    </Button>
                </div>
            </div>
        </header>
    );
}
