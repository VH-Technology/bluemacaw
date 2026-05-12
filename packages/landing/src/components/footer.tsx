interface FooterProps {
    version: string;
}

export function Footer({ version }: FooterProps) {
    return (
        <footer className="border-t border-border bg-bg py-10">
            <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo.svg" alt="" aria-hidden="true" className="h-7 w-7" />
                    <div className="text-sm text-muted-foreground">
                        <span className="font-bold text-fg">Joe the bird</span>
                        <span className="mx-2 opacity-60">·</span>
                        Apache 2.0
                        <span className="mx-2 opacity-60">·</span>v{version}
                    </div>
                </div>
                <nav className="flex flex-wrap items-center gap-5 text-sm">
                    <a
                        href="/privacy/"
                        className="font-semibold text-muted-foreground transition-colors hover:text-fg"
                    >
                        Privacy
                    </a>
                    <a
                        href="/changelog/"
                        className="font-semibold text-muted-foreground transition-colors hover:text-fg"
                    >
                        Changelog
                    </a>
                    <a
                        href="https://github.com/programow/vox-era"
                        className="font-semibold text-muted-foreground transition-colors hover:text-fg"
                        rel="noopener noreferrer"
                    >
                        GitHub
                    </a>
                </nav>
            </div>
        </footer>
    );
}
