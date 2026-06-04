import { cn } from '@/lib/utils';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type OverlayState =
    | { kind: 'hidden' }
    | { kind: 'recording' }
    | { kind: 'transcribing' }
    | { kind: 'positioning' };

export interface OverlayWindowProps {
    state: OverlayState;
    onStop?: () => void;
    /**
     * Fires when the user clicks the X button on the recording pill. The
     * pill is hidden in other states, so this is only invoked while the
     * overlay is in `recording`. Callers translate this into the cancel
     * event (so a click takes the same path as the cancel hotkey).
     */
    onCancel?: () => void;
    /**
     * Live microphone peak level in 0..1. Drives the height of the
     * waveform bars and a subtle scale on the recording dot. Defaults to
     * 0 so callers (and tests) that don't wire up the meter still get a
     * sensible static pill.
     */
    level?: number;
    appearance?: PillAppearance;
}

export type PillAppearance = 'macos-blur' | 'solid';

interface PillClassProps {
    appearance: PillAppearance;
}

function pillClass({ appearance }: PillClassProps): string {
    return cn(
        'fixed bottom-3 left-1/2 -translate-x-1/2',
        'flex items-center gap-2',
        'rounded-full pl-2 pr-4 py-2.5',
        'select-none text-white',
        appearance === 'macos-blur' ? 'bg-brand-navy/85 backdrop-blur-md' : 'bg-brand-navy/92',
    );
}

const HANDLE = cn(
    'flex items-center justify-center',
    'cursor-grab active:cursor-grabbing',
    'text-white/70 hover:text-white/95',
    'leading-none',
    'px-1',
);

function startDrag(e: React.MouseEvent<HTMLSpanElement>) {
    if (e.button !== 0) return;
    void getCurrentWindow()
        .startDragging()
        .catch((err) => console.warn('OverlayWindow: startDragging failed', err));
}

function DragHandle() {
    return (
        <span
            className={HANDLE}
            data-testid="overlay-drag-handle"
            data-tauri-drag-region
            onMouseDown={startDrag}
            aria-label="Drag to move overlay"
            title="Drag"
        >
            ⠿
        </span>
    );
}

function clampLevel(level: number): number {
    if (!Number.isFinite(level) || level < 0) return 0;
    if (level > 1) return 1;
    return level;
}

function RecordingDot({ level }: { level: number }) {
    // Subtle scale tied to level keeps the dot visually anchored to the
    // bars; cap the boost so the dot can't bloom past the pill height.
    // Mapped against BAR_MAX_LEVEL so it tracks the bars at typical voice
    // amplitudes instead of needing a shout to react.
    const scale = 1 + Math.min(1, clampLevel(level) / BAR_MAX_LEVEL) * 0.4;
    return (
        <span
            aria-hidden="true"
            data-testid="overlay-recording-dot"
            className="pointer-events-none inline-block h-2 w-2 rounded-full bg-brand-coral animate-pulse"
            style={{ transform: `scale(${scale.toFixed(3)})`, transformOrigin: 'center' }}
        />
    );
}

// Each bar lights up once the level crosses its threshold. The bar's
// height is then proportional to how far past the threshold the level
// has gone, clamped to BAR_MAX_PX. Below the threshold the bar stays at
// BAR_MIN_PX so the pill never looks empty.
//
// Thresholds are calibrated against typical conversational speech peaks
// (~0.05–0.20 in the cpal RMS-of-mono signal): the lowest bar reacts to
// any audible voice, and a slightly raised voice lights all four. The
// previous calibration (0.1/0.3/0.5/0.7) required shouting to fill —
// useless feedback for someone speaking naturally into a built-in mic.
const BAR_THRESHOLDS = [0.008, 0.025, 0.05, 0.1] as const;
const BAR_MIN_PX = 3;
const BAR_MAX_PX = 14;
// Level at which a bar reaches BAR_MAX_PX. Built-in mics on real-world
// laptops peak much lower than studio gear, so the saturation ceiling is
// kept well below 1.0 — otherwise normal speech only ever fills the bars
// to ~30% height even when all four are "active".
const BAR_MAX_LEVEL = 0.18;

function barHeightPx(level: number, threshold: number): number {
    const clamped = clampLevel(level);
    if (clamped <= threshold) return BAR_MIN_PX;
    const denom = Math.max(BAR_MAX_LEVEL - threshold, 0.0001);
    const t = Math.min(1, (clamped - threshold) / denom);
    return BAR_MIN_PX + (BAR_MAX_PX - BAR_MIN_PX) * t;
}

function Waveform({ level }: { level: number }) {
    return (
        <span
            className="pointer-events-none flex items-end gap-0.5"
            aria-hidden="true"
            data-testid="overlay-waveform"
        >
            {BAR_THRESHOLDS.map((threshold, i) => {
                const height = barHeightPx(level, threshold);
                const active = clampLevel(level) > threshold;
                return (
                    <span
                        key={threshold}
                        data-testid={`overlay-waveform-bar-${i}`}
                        data-active={active ? 'true' : 'false'}
                        className={cn(
                            'block w-0.5 rounded-sm transition-[height,background-color,opacity] duration-75 ease-out',
                            active
                                ? 'bg-brand-yellow opacity-100'
                                : 'bg-brand-yellow/40 opacity-80',
                        )}
                        style={{ height: `${height.toFixed(2)}px` }}
                    />
                );
            })}
        </span>
    );
}

function StopButton({ onClick }: { onClick?: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Stop recording"
            title="Stop"
            className={cn(
                'ml-1 flex h-5 w-5 items-center justify-center rounded-full',
                'bg-white/15 text-white/85',
                'hover:bg-white/25 hover:text-white active:bg-white/35',
                'transition-colors',
            )}
        >
            <span aria-hidden="true" className="block h-2 w-2 rounded-[1px] bg-current" />
        </button>
    );
}

function CancelButton({ onClick }: { onClick?: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Cancel recording"
            title="Cancel"
            data-testid="overlay-cancel-button"
            className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full',
                'bg-white/15 text-white/85',
                'hover:bg-brand-coral/40 hover:text-white active:bg-brand-coral/60',
                'transition-colors',
            )}
        >
            <svg
                aria-hidden="true"
                viewBox="0 0 10 10"
                className="block h-2.5 w-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
            >
                <path d="M2 2 L8 8 M8 2 L2 8" />
            </svg>
        </button>
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

export function OverlayWindow({
    state,
    onStop,
    onCancel,
    level = 0,
    appearance = 'macos-blur',
}: OverlayWindowProps) {
    const cls = pillClass({ appearance });

    if (state.kind === 'hidden') return null;

    if (state.kind === 'recording') {
        return (
            <div className={cls} data-testid="overlay-pill" data-state="recording">
                <DragHandle />
                <RecordingDot level={level} />
                <Waveform level={level} />
                <span className="pointer-events-none text-[11px] font-semibold tracking-wide">
                    Recording
                </span>
                <CancelButton onClick={onCancel} />
                <StopButton onClick={onStop} />
            </div>
        );
    }

    if (state.kind === 'transcribing') {
        return (
            <div className={cls} data-testid="overlay-pill" data-state="transcribing">
                <DragHandle />
                <TranscribingDots />
                <span className="pointer-events-none text-[11px] font-semibold tracking-wide">
                    Transcribing
                </span>
            </div>
        );
    }

    return (
        <div className={cls} data-testid="overlay-pill" data-state="positioning">
            <DragHandle />
            <span className="pointer-events-none text-[11px] font-medium tracking-wide">
                Drag to position
            </span>
        </div>
    );
}
