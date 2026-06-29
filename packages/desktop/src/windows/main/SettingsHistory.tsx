import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { WarningBanner } from '@/components/ui/warning-banner';
import {
    clearAllTranscriptions,
    getRetentionDays,
    purgeOlderThan,
    setRetentionDays,
} from '@/lib/db';
import { useEffect, useId, useState } from 'react';

const OPTIONS = [
    { value: 30, label: '30 days' },
    { value: 90, label: '90 days' },
    { value: 365, label: '365 days (default)' },
    { value: -1, label: 'Forever' },
];

export interface SettingsHistoryProps {
    /** Fired after a destructive action (Clear all, retention purge) so the
     * parent can refetch the History list + Dashboard stats. Without this
     * the user has to relaunch the app to see the now-empty list. */
    onHistoryChanged?: () => void;
}

export function SettingsHistory({ onHistoryChanged }: SettingsHistoryProps = {}) {
    const retainId = useId();
    const [retainDays, setRetainDays] = useState<number>(365);
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        void getRetentionDays().then(setRetainDays);
    }, []);

    async function handleChange(next: number) {
        setRetainDays(next);
        await setRetentionDays(next);
        const result = await purgeOlderThan(next);
        if (result.softDeleted > 0 || result.hardDeleted > 0) {
            onHistoryChanged?.();
        }
    }

    async function handleConfirmClear() {
        await clearAllTranscriptions();
        setConfirming(false);
        onHistoryChanged?.();
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm font-medium normal-case">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <div className="flex flex-col gap-1">
                        <Label htmlFor={retainId}>Retain transcriptions for</Label>
                        <Select
                            id={retainId}
                            value={String(retainDays)}
                            onChange={(e) => void handleChange(Number(e.target.value))}
                        >
                            {OPTIONS.map((o) => (
                                <option key={o.value} value={String(o.value)}>
                                    {o.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <Button
                        variant="outline"
                        className="border-red-500/30 text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                        onClick={() => setConfirming(true)}
                    >
                        Clear all
                    </Button>
                </div>
                {confirming && (
                    <WarningBanner data-testid="clear-all-confirm">
                        <p>This deletes all transcriptions and cannot be undone.</p>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setConfirming(false)}>
                                Cancel
                            </Button>
                            <Button variant="destructive" onClick={() => void handleConfirmClear()}>
                                Confirm
                            </Button>
                        </div>
                    </WarningBanner>
                )}
            </CardContent>
        </Card>
    );
}
