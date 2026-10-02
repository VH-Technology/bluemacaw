import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getDeepgramSmartFormatEnabled, setDeepgramSmartFormatEnabled } from '@/lib/db';
import { useEffect, useId, useState } from 'react';

/**
 * Switch for Deepgram's `smart_format` option. Without it Deepgram returns
 * bare lowercase words, which also leaves transcript cleanup with all the
 * punctuation work.
 */
export function SettingsDeepgramFormatting() {
    const toggleId = useId();
    const [enabled, setEnabled] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const saved = await getDeepgramSmartFormatEnabled();
                if (!cancelled) setEnabled(saved);
            } catch (e) {
                console.error('getDeepgramSmartFormatEnabled failed', e);
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    async function handleToggle(next: boolean) {
        // Optimistic flip so the switch feels immediate; revert + surface an
        // inline error if the write fails.
        const previous = enabled;
        setEnabled(next);
        setError(null);
        try {
            await setDeepgramSmartFormatEnabled(next);
        } catch (e) {
            console.error('setDeepgramSmartFormatEnabled failed', e);
            setEnabled(previous);
            setError(e instanceof Error ? e.message : String(e));
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/30 p-3">
                <div className="flex flex-col gap-0.5 pr-3">
                    <Label htmlFor={toggleId} className="cursor-pointer">
                        Deepgram punctuation and formatting
                    </Label>
                    <p className="text-xs text-muted-foreground">
                        Asks Deepgram to add punctuation, capital letters and number formatting to
                        its transcripts. Applies to the Nova and Enhanced models.
                    </p>
                </div>
                <Switch
                    id={toggleId}
                    data-testid="settings-deepgram-formatting-toggle"
                    checked={enabled}
                    disabled={!loaded}
                    onCheckedChange={(value: boolean) => void handleToggle(value)}
                />
            </div>
            {error && (
                <p className="text-xs font-bold text-red-700" role="alert">
                    Could not save the Deepgram setting: {error}
                </p>
            )}
        </div>
    );
}
