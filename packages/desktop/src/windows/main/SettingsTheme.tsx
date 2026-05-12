import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type Theme, useTheme } from '@/lib/use-theme';

const OPTIONS: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
];

export function SettingsTheme() {
    const { preference, resolved, setPreference } = useTheme();
    return (
        <Card>
            <CardHeader>
                <CardTitle>Theme</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm font-medium normal-case">
                {OPTIONS.map((opt) => (
                    <label
                        key={opt.value}
                        className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
                    >
                        <input
                            type="radio"
                            name="theme"
                            value={opt.value}
                            checked={preference === opt.value}
                            onChange={() => void setPreference(opt.value)}
                        />
                        {opt.label}
                    </label>
                ))}
                {preference === 'system' && (
                    <span
                        className="text-xs text-muted-foreground normal-case tracking-normal"
                        data-testid="theme-resolved-hint"
                    >
                        Currently using: {resolved}
                    </span>
                )}
            </CardContent>
        </Card>
    );
}
