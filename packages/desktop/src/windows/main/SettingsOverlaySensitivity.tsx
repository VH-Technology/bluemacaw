import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { getOverlaySensitivity, setOverlaySensitivity } from '@/lib/db';
import {
    DEFAULT_OVERLAY_SENSITIVITY,
    MAX_OVERLAY_SENSITIVITY,
    MIN_OVERLAY_SENSITIVITY,
    OVERLAY_SENSITIVITY_CHANGED_EVENT,
} from '@/lib/overlay-sensitivity';
import { emit } from '@tauri-apps/api/event';
import { useEffect, useId, useRef, useState } from 'react';

export function SettingsOverlaySensitivity() {
    const id = useId();
    const [value, setValue] = useState(DEFAULT_OVERLAY_SENSITIVITY);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const saved = useRef(DEFAULT_OVERLAY_SENSITIVITY);
    const queue = useRef(Promise.resolve());
    const revision = useRef(0);

    useEffect(() => {
        let cancelled = false;
        void getOverlaySensitivity()
            .then((next) => {
                if (cancelled) return;
                saved.current = next;
                setValue(next);
                setLoaded(true);
            })
            .catch(() => {
                if (!cancelled)
                    setError('Could not load meter sensitivity. Reopen Settings to retry.');
            });
        return () => {
            cancelled = true;
        };
    }, []);

    function changeSensitivity(next: number) {
        setValue(next);
        setError(null);
        const currentRevision = ++revision.current;
        // Serialize writes so dragging cannot let an older save win. Skip
        // intermediate values that have not started saving yet.
        queue.current = queue.current.then(async () => {
            if (currentRevision !== revision.current) return;
            try {
                await setOverlaySensitivity(next);
                saved.current = next;
            } catch {
                if (currentRevision === revision.current) {
                    setValue(saved.current);
                    setError('Could not save meter sensitivity. Please try again.');
                }
                return;
            }
            // The overlay also reloads on recording start if this notification fails.
            await emit(OVERLAY_SENSITIVITY_CHANGED_EVENT).catch((err) => {
                console.warn('Overlay sensitivity notification failed', err);
            });
        });
    }

    const percent = Math.round(value * 100);
    return (
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3">
                <Label htmlFor={id}>Volume indicator sensitivity</Label>
                <output htmlFor={id} className="tabular-nums">
                    {percent}%
                </output>
            </div>
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                Lower this if the recording pill reacts too strongly. Only affects the visual meter,
                not microphone volume or transcription. 100% is the default.
            </p>
            <input
                id={id}
                type="range"
                min={MIN_OVERLAY_SENSITIVITY * 100}
                max={MAX_OVERLAY_SENSITIVITY * 100}
                step={10}
                value={percent}
                disabled={!loaded}
                aria-describedby={`${id}-hint`}
                aria-valuetext={`${percent}%`}
                onChange={(event) => changeSensitivity(Number(event.target.value) / 100)}
                className="w-full accent-main"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
                <span>Less sensitive</span>
                <span>More sensitive</span>
            </div>
            <Button
                variant="outline"
                size="sm"
                className="self-end"
                disabled={!loaded || value === DEFAULT_OVERLAY_SENSITIVITY}
                onClick={() => changeSensitivity(DEFAULT_OVERLAY_SENSITIVITY)}
            >
                Reset sensitivity
            </Button>
            {error && (
                <p role="alert" className="text-xs text-red-700">
                    {error}
                </p>
            )}
        </div>
    );
}
