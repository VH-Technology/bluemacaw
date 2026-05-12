'use client';

import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

type PillState = 'recording' | 'transcribing' | 'pasted';

// Tick interval for the auto-cycle. Constant cadence is "good enough" for a
// marketing animation — the eye won't notice that each state isn't perfectly
// proportional to a real session. If exact pacing matters, switch to
// chained setTimeouts and give each state its own duration.
const TICK_MS = 2000;

const NEXT_STATE: Record<PillState, PillState> = {
    recording: 'transcribing',
    transcribing: 'pasted',
    pasted: 'recording',
};

const PILL = cn(
    'inline-flex items-center gap-2.5 rounded-full',
    'bg-brand-navy/90 backdrop-blur-md',
    'pl-3 pr-4 py-2.5',
    'select-none text-white shadow-pop',
);

function RecordingDot() {
    return (
        <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full bg-brand-coral animate-pulse"
        />
    );
}

// Four bars with staggered CSS animations — no real audio, just a believable
// "voice waveform" loop while the pill is in the recording state. Keyframes
// are inlined as a <style> tag below the component so we don't have to touch
// tailwind.config to register a custom animation.
function Waveform() {
    return (
        <span
            className="pointer-events-none flex h-3.5 items-end gap-0.5"
            aria-hidden="true"
            data-testid="recording-pill-waveform"
        >
            {[0, 1, 2, 3].map((i) => (
                <span
                    key={i}
                    className="block w-0.5 rounded-sm bg-brand-yellow [animation:waveform-bar_1.1s_ease-in-out_infinite]"
                    style={{ animationDelay: `${i * 130}ms` }}
                />
            ))}
        </span>
    );
}

function TranscribingDots() {
    return (
        <span className="pointer-events-none flex items-center gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
                <span
                    key={i}
                    className="block h-1.5 w-1.5 rounded-full bg-brand-yellow animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                />
            ))}
        </span>
    );
}

function CheckIcon() {
    return (
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
    );
}

export interface RecordingPillDemoProps {
    /**
     * Optional starting state for tests — when set, the auto-cycle is
     * disabled so the component renders deterministically.
     */
    initialState?: PillState;
}

export function RecordingPillDemo({ initialState }: RecordingPillDemoProps = {}) {
    const [state, setState] = useState<PillState>(initialState ?? 'recording');

    useEffect(() => {
        if (initialState !== undefined) return;
        const id = window.setInterval(() => {
            setState((prev) => NEXT_STATE[prev]);
        }, TICK_MS);
        return () => window.clearInterval(id);
    }, [initialState]);

    return (
        <div data-testid="recording-pill" data-state={state}>
            <div className={PILL}>
                {state === 'recording' && (
                    <>
                        <RecordingDot />
                        <Waveform />
                        <span className="text-[12px] font-semibold tracking-wide">Recording</span>
                    </>
                )}
                {state === 'transcribing' && (
                    <>
                        <TranscribingDots />
                        <span className="text-[12px] font-semibold tracking-wide">
                            Transcribing…
                        </span>
                    </>
                )}
                {state === 'pasted' && (
                    <>
                        <CheckIcon />
                        <span className="text-[12px] font-semibold tracking-wide">Pasted</span>
                    </>
                )}
            </div>
            {/* Keyframes for the waveform bars. Inlined so the component is
                self-contained and the marketing page doesn't grow Tailwind's
                animation config. */}
            <style>{`
                @keyframes waveform-bar {
                    0%, 100% { height: 3px; opacity: 0.55; }
                    50% { height: 14px; opacity: 1; }
                }
            `}</style>
        </div>
    );
}
