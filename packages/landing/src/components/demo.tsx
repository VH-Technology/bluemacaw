// Self-contained mockup of the dictation flow. Replaces the earlier <Image
// src="/demo.gif" /> while the real screen recording is being produced — the
// previous placeholder gif was a 43-byte stub that rendered as a broken-image
// section on the landing page.
export function Demo() {
    return (
        <section aria-label="Recording demo" className="mx-auto max-w-5xl px-6 py-12">
            <div className="overflow-hidden rounded-3xl bg-brand-cream/40 p-6 shadow-pop sm:p-8 dark:bg-brand-navy/30">
                <div className="rounded-2xl bg-bg p-6 sm:p-10">
                    <div className="mb-6 flex flex-wrap items-center justify-center gap-2 text-sm">
                        <Kbd>⌘</Kbd>
                        <span className="opacity-50">+</span>
                        <Kbd>⇧</Kbd>
                        <span className="opacity-50">+</span>
                        <Kbd>Space</Kbd>
                        <span className="ml-3 text-muted-foreground">hold to dictate</span>
                    </div>

                    <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                            <span className="relative inline-flex h-2.5 w-2.5">
                                <span className="absolute inset-0 animate-ping rounded-full bg-brand-coral/60" />
                                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-coral" />
                            </span>
                            Recording — OpenAI · gpt-4o-mini-transcribe
                        </div>
                        <p className="mt-4 text-lg leading-relaxed text-fg sm:text-xl">
                            Schedule a follow-up with the design team next Tuesday at three, and
                            remind me to share the new dashboard mockups before the meeting.
                        </p>
                    </div>

                    <p className="mt-6 text-center text-sm text-muted-foreground">
                        Release the key → text pastes into the focused app instantly.
                    </p>
                </div>
            </div>
        </section>
    );
}

function Kbd({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-sm font-semibold text-fg shadow-sm">
            {children}
        </kbd>
    );
}
