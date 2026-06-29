const FEATURES = [
    {
        title: 'Free and open source',
        body: 'Apache 2.0 software with no paid tier. Read the code, fork it, and verify the privacy story yourself.',
    },
    {
        title: 'Dictate in any app',
        body: 'Press a shortcut, speak naturally, and paste speech-to-text output wherever your cursor is.',
    },
    {
        title: '10 AI transcription providers',
        body: 'OpenAI, Groq, Grok (xAI), Deepgram, AssemblyAI, ElevenLabs, Fal, Gladia, Azure OpenAI, Rev.ai.',
    },
    {
        title: 'Private by design',
        body: 'Your API keys live in your OS keychain. There is no bluemacaw cloud backend collecting voice data.',
    },
    {
        title: 'Mac and Windows desktop app',
        body: 'Same global hotkey, same voice-to-text workflow, and native installers for macOS and Windows.',
    },
    {
        title: 'Cost-aware BYOK',
        body: 'Bring your own key, choose the speech model you trust, and see estimated cost per provider in the dashboard.',
    },
];

export function Features() {
    return (
        <section id="features" className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-10 text-center">
                <h2 className="text-3xl font-black tracking-tight sm:text-4xl">
                    Free open source dictation, built for privacy.
                </h2>
                <p className="mt-3 text-muted-foreground">
                    Voice typing should be fast, transparent, and yours. No account, no upgrade
                    tier, no usage caps from bluemacaw.
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
