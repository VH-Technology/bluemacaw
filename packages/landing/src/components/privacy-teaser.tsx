export function PrivacyTeaser() {
    return (
        <section className="mx-auto max-w-4xl px-6 py-20">
            <div className="relative overflow-hidden rounded-3xl bg-brand-cream/40 p-8 shadow-card sm:p-12 dark:bg-brand-navy/40">
                {/* Decorative coral accent in the corner — small brand cue. */}
                <span
                    aria-hidden="true"
                    className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-brand-coral/15 blur-2xl"
                />
                <h2 className="relative text-3xl font-black tracking-tight text-fg sm:text-4xl">
                    Where do your keys live?
                </h2>
                <p className="relative mt-4 max-w-2xl text-base text-fg/80 sm:text-lg">
                    Your API keys go straight into your OS&apos;s native credential store — Keychain
                    on macOS, Credential Manager on Windows, Secret Service on Linux. They never
                    touch a Joe the bird server because there isn&apos;t one.
                </p>
                <a
                    href="/privacy/"
                    className="relative mt-6 inline-flex items-center gap-1 text-sm font-bold text-main hover:underline"
                >
                    Read the full privacy story <span aria-hidden="true">→</span>
                </a>
            </div>
        </section>
    );
}
