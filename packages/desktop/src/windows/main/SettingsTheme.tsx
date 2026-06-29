import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { autostart } from '@/lib/autostart';
import { type Theme, useTheme } from '@/lib/use-theme';
import { cn } from '@/lib/utils';
import { useEffect, useId, useState } from 'react';

const OPTIONS: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
];

function ThemeIcon({ theme }: { theme: Theme }) {
    if (theme === 'light') {
        return (
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-8 w-8"
                aria-hidden="true"
            >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" />
                <path d="M12 20v2" />
                <path d="m4.93 4.93 1.41 1.41" />
                <path d="m17.66 17.66 1.41 1.41" />
                <path d="M2 12h2" />
                <path d="M20 12h2" />
                <path d="m6.34 17.66-1.41 1.41" />
                <path d="m19.07 4.93-1.41 1.41" />
            </svg>
        );
    }

    if (theme === 'dark') {
        return (
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-8 w-8"
                aria-hidden="true"
            >
                <path d="M20.99 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 20.99 12.79Z" />
            </svg>
        );
    }

    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8"
            aria-hidden="true"
        >
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8" />
            <path d="M12 16v4" />
            <path d="M7 8h3" />
            <path d="M14 8h3" />
        </svg>
    );
}

export function SettingsTheme() {
    const autostartId = useId();
    const { preference, resolved, setPreference } = useTheme();
    const [autostartEnabled, setAutostartEnabled] = useState(false);
    const [autostartError, setAutostartError] = useState<string | null>(null);

    useEffect(() => {
        void (async () => {
            try {
                setAutostartEnabled(await autostart.isEnabled());
            } catch (e) {
                console.error('autostart.isEnabled failed', e);
            }
        })();
    }, []);

    async function handleAutostartToggle(next: boolean) {
        const previous = autostartEnabled;
        setAutostartEnabled(next);
        setAutostartError(null);
        try {
            await autostart.set(next);
        } catch (e) {
            console.error('autostart.set failed', e);
            setAutostartEnabled(previous);
            setAutostartError(e instanceof Error ? e.message : String(e));
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>General</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm font-medium normal-case">
                <Label>Theme</Label>
                <div className="grid gap-3 sm:grid-cols-3">
                    {OPTIONS.map((opt) => {
                        const selected = preference === opt.value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => void setPreference(opt.value)}
                                className={cn(
                                    'flex min-h-28 flex-col items-center justify-between rounded-2xl border p-4 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40',
                                    selected
                                        ? 'border-main bg-main/10 text-fg shadow-card'
                                        : 'border-border bg-muted/30 text-muted-foreground hover:-translate-y-0.5 hover:border-main/40 hover:bg-muted hover:text-fg',
                                )}
                            >
                                <span className="flex flex-1 items-center justify-center">
                                    <ThemeIcon theme={opt.value} />
                                </span>
                                <span className="mt-3 text-xs font-extrabold uppercase tracking-[0.14em]">
                                    {opt.label}
                                </span>
                            </button>
                        );
                    })}
                </div>
                {preference === 'system' && (
                    <span
                        className="text-xs text-muted-foreground normal-case tracking-normal"
                        data-testid="theme-resolved-hint"
                    >
                        Currently using: {resolved}
                    </span>
                )}
                <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/30 p-3">
                    <div className="flex flex-col gap-0.5 pr-3">
                        <Label htmlFor={autostartId} className="cursor-pointer">
                            Start at login
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            Launch bluemacaw automatically into the tray when you sign in.
                        </p>
                    </div>
                    <Switch
                        id={autostartId}
                        data-testid="settings-autostart-toggle"
                        checked={autostartEnabled}
                        onCheckedChange={(v: boolean) => void handleAutostartToggle(v)}
                    />
                </div>
                {autostartError && (
                    <p
                        data-testid="settings-autostart-error"
                        className="text-xs font-bold uppercase tracking-widest text-red-700"
                    >
                        {autostartError}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
