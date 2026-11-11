import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { vox } from '@/lib/invoke';
import { usePlatform } from '@/lib/use-platform';
import { useEffect, useId, useState } from 'react';

export function SettingsDock() {
    const id = useId();
    const platform = usePlatform();
    const isMac = platform?.os === 'macos';
    const [enabled, setEnabled] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isMac) return;
        let cancelled = false;
        void vox
            .getKeepInDock()
            .then((value) => {
                if (cancelled) return;
                setEnabled(value);
                setLoaded(true);
            })
            .catch(() => {
                if (!cancelled)
                    setError('Could not load Dock preference. Reopen Settings to retry.');
            });
        return () => {
            cancelled = true;
        };
    }, [isMac]);

    async function changePreference(next: boolean) {
        setSaving(true);
        setError(null);
        try {
            await vox.setKeepInDock(next);
            setEnabled(next);
        } catch {
            setError('Could not save Dock preference. Please try again.');
        } finally {
            setSaving(false);
        }
    }

    if (!isMac) return null;
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/30 p-3">
                <div className="flex flex-col gap-0.5 pr-3">
                    <Label htmlFor={id} className="cursor-pointer">
                        Keep in Dock when the window is closed
                    </Label>
                    <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                        When off, bluemacaw stays in the menu bar only after you close the window.
                        Open it again from the menu bar to bring the window and Dock icon back.
                    </p>
                </div>
                <Switch
                    id={id}
                    aria-describedby={`${id}-hint`}
                    checked={enabled}
                    disabled={!loaded || saving}
                    onCheckedChange={(next) => void changePreference(next)}
                />
            </div>
            {error && (
                <p role="alert" className="text-xs text-red-700">
                    {error}
                </p>
            )}
        </div>
    );
}
