'use client';

import { osMeta, useClientOS } from '@/lib/use-client-os';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

// An interactive, looping mock of a real bluemacaw session — replaces the
// old broken demo.gif. Instead of a video we drive a tiny state machine
// through the actual UX beats (press shortcut → record → transcribe → paste)
// so the "demo" is a live component that adapts to the visitor's OS and
// theme, and never ships a heavy asset. Honors prefers-reduced-motion by
// rendering the finished state statically.

type Phase = 'idle' | 'recording' | 'transcribing' | 'typing' | 'done';

const TRANSCRIPT =
    'Schedule a follow-up with the design team next Tuesday at three, and remind me to share the dashboard mockups.';
const WORDS = TRANSCRIPT.split(' ');

const NEXT: Record<Phase, Phase> = {
    idle: 'recording',
    recording: 'transcribing',
    transcribing: 'typing',
    typing: 'done',
    done: 'idle',
};

// Per-phase dwell time (ms). `typing` isn't here — its duration is driven by
// the word-reveal cadence below.
const PHASE_MS: Record<Exclude<Phase, 'typing'>, number> = {
    idle: 1400,
    recording: 2400,
    transcribing: 1100,
    done: 1900,
};
const WORD_MS = 90;

export interface DemoProps {
    /**
     * Test seam: when set, the auto-cycle is disabled and the component
     * renders this phase deterministically. Production never passes it.
     */
    initialPhase?: Phase;
}

export function Demo({ initialPhase }: DemoProps = {}) {
    const os = useClientOS();
    const [phase, setPhase] = useState<Phase>(initialPhase ?? 'idle');
    const [wordCount, setWordCount] = useState(0);
    const [reduced, setReduced] = useState(false);

    // Detect reduced-motion once on mount. For a marketing loop we don't
    // bother subscribing to changes — a visitor toggling the OS setting
    // mid-view is not worth the listener.
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }, []);

    const running = initialPhase === undefined && !reduced;

    // Phase clock for every phase except `typing`.
    useEffect(() => {
        if (!running || phase === 'typing') return;
        const id = window.setTimeout(() => {
            // Reset the transcript right before we loop back to idle so the
            // next cycle types from an empty document.
            if (phase === 'done') setWordCount(0);
            setPhase(NEXT[phase]);
        }, PHASE_MS[phase]);
        return () => window.clearTimeout(id);
    }, [running, phase]);

    // Word-by-word reveal during `typing`, then advance to `done`.
    useEffect(() => {
        if (!running || phase !== 'typing') return;
        if (wordCount >= WORDS.length) {
            const id = window.setTimeout(() => setPhase('done'), 450);
            return () => window.clearTimeout(id);
        }
        const id = window.setTimeout(() => setWordCount((c) => c + 1), WORD_MS);
        return () => window.clearTimeout(id);
    }, [running, phase, wordCount]);

    const displayPhase: Phase = reduced ? 'done' : (initialPhase ?? phase);
    const revealed =
        displayPhase === 'done' ? WORDS.length : displayPhase === 'typing' ? wordCount : 0;
    const shownText = WORDS.slice(0, revealed).join(' ');
    const shortcut = osMeta(os).shortcut;

    return (
        <section aria-label="Recording demo" className="mx-auto max-w-5xl px-6 py-12">
            <div className="overflow-hidden rounded-3xl bg-brand-cream/40 p-4 shadow-pop sm:p-8 dark:bg-brand-navy/30">
                {/* Faux app window */}
                <div
                    className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-card-lg"
                    data-testid="demo-window"
                    data-phase={displayPhase}
                >
                    {/* Title bar with traffic-light dots */}
                    <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5">
                        <span className="flex gap-1.5" aria-hidden="true">
                            <span className="h-3 w-3 rounded-full bg-brand-coral/80" />
                            <span className="h-3 w-3 rounded-full bg-brand-yellow/80" />
                            <span className="h-3 w-3 rounded-full bg-brand-mint/80" />
                        </span>
                        <span className="ml-2 text-xs font-semibold text-muted-foreground">
                            Notes — bluemacaw
                        </span>
                    </div>

                    {/* Document body */}
                    <div className="relative min-h-[180px] px-6 py-6 sm:min-h-[200px]">
                        {shownText ? (
                            <p className="text-left text-lg leading-relaxed text-fg sm:text-xl">
                                {shownText}
                                {displayPhase === 'typing' && (
                                    <span
                                        aria-hidden="true"
                                        className="ml-0.5 inline-block h-5 w-0.5 translate-y-0.5 animate-pulse bg-main"
                                    />
                                )}
                            </p>
                        ) : (
                            <div className="flex h-full min-h-[148px] flex-col items-center justify-center gap-3 text-center">
                                <p className="text-sm text-muted-foreground">
                                    {displayPhase === 'recording'
                                        ? 'Listening… speak naturally.'
                                        : displayPhase === 'transcribing'
                                          ? 'Turning speech into text…'
                                          : 'Press to dictate into any app.'}
                                </p>
                                <span className="flex flex-wrap items-center justify-center gap-1.5">
                                    {shortcut.map((key, i) => (
                                        <span key={key} className="flex items-center gap-1.5">
                                            {i > 0 && (
                                                <span className="text-xs text-muted-foreground">
                                                    +
                                                </span>
                                            )}
                                            <kbd className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs font-semibold text-fg shadow-sm">
                                                {key}
                                            </kbd>
                                        </span>
                                    ))}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Floating status pill — mirrors the real desktop overlay */}
                    <div className="flex justify-center pb-6">
                        <StatusPill phase={displayPhase} />
                    </div>
                </div>

                <p className="mt-6 text-center text-sm text-muted-foreground">
                    A live preview — no video, just the real UI. Hold{' '}
                    {osMeta(os).label === 'macOS' ? '⌘⇧Space' : 'Ctrl+⇧Space'}, talk, release.
                </p>
            </div>
        </section>
    );
}

const PILL = cn(
    'inline-flex items-center gap-2.5 rounded-full',
    'bg-brand-navy/90 backdrop-blur-md',
    'pl-3 pr-4 py-2 select-none text-white shadow-pop',
);

function StatusPill({ phase }: { phase: Phase }) {
    if (phase === 'recording') {
        return (
            <div className={PILL} data-testid="demo-pill" data-state="recording">
                <span className="inline-block h-2 w-2 rounded-full bg-brand-coral animate-pulse" />
                <Waveform />
                <span className="text-[12px] font-semibold tracking-wide">Recording</span>
            </div>
        );
    }
    if (phase === 'transcribing') {
        return (
            <div className={PILL} data-testid="demo-pill" data-state="transcribing">
                <span className="flex items-center gap-1" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                        <span
                            key={i}
                            className="block h-1.5 w-1.5 rounded-full bg-brand-yellow animate-bounce"
                            style={{ animationDelay: `${i * 150}ms` }}
                        />
                    ))}
                </span>
                <span className="text-[12px] font-semibold tracking-wide">Transcribing…</span>
            </div>
        );
    }
    if (phase === 'typing' || phase === 'done') {
        return (
            <div className={PILL} data-testid="demo-pill" data-state="pasted">
                <svg
                    aria-hidden="true"
                    viewBox="0 0 12 12"
                    className="h-3 w-3 text-brand-mint"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M2 6.5 L5 9.5 L10 3" />
                </svg>
                <span className="text-[12px] font-semibold tracking-wide">Pasted</span>
            </div>
        );
    }
    // idle
    return (
        <div className={cn(PILL, 'bg-brand-navy/70')} data-testid="demo-pill" data-state="idle">
            <span className="inline-block h-2 w-2 rounded-full bg-white/50" />
            <span className="text-[12px] font-semibold tracking-wide text-white/80">Ready</span>
        </div>
    );
}

function Waveform() {
    return (
        <span
            className="pointer-events-none flex h-3.5 items-end gap-0.5"
            aria-hidden="true"
            data-testid="demo-waveform"
        >
            {[0, 1, 2, 3].map((i) => (
                <span
                    key={i}
                    className="block w-0.5 rounded-sm bg-brand-yellow [animation:demo-waveform-bar_1.1s_ease-in-out_infinite]"
                    style={{ animationDelay: `${i * 130}ms` }}
                />
            ))}
            <style>{`
                @keyframes demo-waveform-bar {
                    0%, 100% { height: 3px; opacity: 0.55; }
                    50% { height: 14px; opacity: 1; }
                }
            `}</style>
        </span>
    );
}
