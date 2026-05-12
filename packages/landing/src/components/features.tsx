const FEATURES = [
    {
        title: 'BYOK',
        body: 'Your API keys live in your OS keychain. There is no Joe the bird backend.',
    },
    {
        title: '9 providers',
        body: 'OpenAI, Groq, Deepgram, AssemblyAI, ElevenLabs, Fal, Gladia, Azure OpenAI, Rev.ai.',
    },
    {
        title: 'Cross-platform',
        body: 'macOS, Windows, Linux. Same shortcut. Same UX.',
    },
    {
        title: 'Open source',
        body: 'Apache 2.0. Read the code. Verify the privacy story for yourself.',
    },
    {
        title: 'Auto-update',
        body: 'Signed releases delivered from a minisign-verified update manifest.',
    },
    {
        title: 'Cost-aware',
        body: 'See estimated cost per provider and model right in the dashboard.',
    },
];

export function Features() {
    return (
        <section id="features" className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-10 text-center">
                <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
                    Made for dictating, not for selling your data.
                </h2>
                <p className="mt-3 text-muted-foreground">
                    Everything below is on by default. No upgrade tier, no usage caps.
                </p>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {FEATURES.map((f) => (
                    <article
                        key={f.title}
                        className="group relative rounded-2xl bg-surface p-6 shadow-card transition-shadow hover:shadow-card-lg"
                    >
                        {/* Brand-yellow corner badge — mirrors the "yellow accent over navy" motif from the desktop. */}
                        <span
                            aria-hidden="true"
                            className="absolute right-5 top-5 h-2 w-2 rounded-full bg-brand-yellow"
                        />
                        <h3 className="text-lg font-bold tracking-tight">{f.title}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            {f.body}
                        </p>
                    </article>
                ))}
            </div>
        </section>
    );
}
