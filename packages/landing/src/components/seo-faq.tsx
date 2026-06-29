export const SEO_FAQS = [
    {
        question: 'What is bluemacaw?',
        answer: 'bluemacaw is a free open-source AI speech-to-text desktop app for Mac and Windows. It lets you dictate with a global hotkey and paste the transcript into the app where your cursor is focused.',
    },
    {
        question: 'Is bluemacaw free and open source?',
        answer: 'Yes. bluemacaw is free software licensed under Apache 2.0. There is no bluemacaw subscription, paid tier, account, or hosted backend.',
    },
    {
        question: 'Does bluemacaw work in every app?',
        answer: 'bluemacaw is designed for system-wide voice dictation. Hold the shortcut, speak naturally, release, and the speech-to-text result is pasted into the focused text field.',
    },
    {
        question: 'How does private voice dictation work?',
        answer: 'You bring your own API key for the AI transcription provider you choose. Keys stay in the OS credential store, and bluemacaw does not proxy your voice through its own server.',
    },
] as const;

export function SeoFaq() {
    return (
        <section className="mx-auto max-w-4xl px-6 py-20" aria-labelledby="seo-faq-title">
            <div className="mb-8 text-center">
                <h2 id="seo-faq-title" className="text-3xl font-black tracking-tight sm:text-4xl">
                    Free open source speech-to-text FAQ.
                </h2>
                <p className="mt-3 text-muted-foreground">
                    Quick answers for people comparing AI dictation, voice typing, and private
                    speech-to-text apps.
                </p>
            </div>
            <div className="space-y-4">
                {SEO_FAQS.map((faq) => (
                    <article key={faq.question} className="rounded-2xl bg-surface p-6 shadow-card">
                        <h3 className="text-lg font-bold tracking-tight">{faq.question}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            {faq.answer}
                        </p>
                    </article>
                ))}
            </div>
        </section>
    );
}
