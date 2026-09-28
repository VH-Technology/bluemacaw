import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
    type ApiKeyRow,
    getTranscriptCleanupApiKeyId,
    listApiKeys,
    setTranscriptCleanupApiKeyId,
} from '@/lib/db';
import { useEffect, useId, useState } from 'react';

interface SettingsCleanupProps {
    refreshToken?: number;
}

export function SettingsCleanup({ refreshToken }: SettingsCleanupProps) {
    const enableId = useId();
    const keyId = useId();
    const [keys, setKeys] = useState<ApiKeyRow[]>([]);
    const [enabled, setEnabled] = useState(false);
    const [selectedKeyId, setSelectedKeyId] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        void refreshToken;
        let cancelled = false;
        setLoaded(false);
        void (async () => {
            const [allKeys, activeKeyId] = await Promise.all([
                listApiKeys(),
                getTranscriptCleanupApiKeyId(),
            ]);
            if (cancelled) return;
            const openaiKeys = allKeys.filter((key) => key.providerId === 'openai');
            const activeKeyExists = openaiKeys.some((key) => key.id === activeKeyId);
            setKeys(openaiKeys);
            setEnabled(activeKeyExists);
            setSelectedKeyId(activeKeyExists ? (activeKeyId ?? '') : '');
            setError(null);
            setLoaded(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [refreshToken]);

    async function handleEnabledChange(next: boolean) {
        if (next && !selectedKeyId) return;
        setSaving(true);
        setError(null);
        try {
            await setTranscriptCleanupApiKeyId(next ? selectedKeyId : null);
            setEnabled(next);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSaving(false);
        }
    }

    async function handleKeyChange(next: string) {
        setError(null);
        if (!enabled) {
            setSelectedKeyId(next);
            return;
        }
        setSaving(true);
        try {
            await setTranscriptCleanupApiKeyId(next);
            setSelectedKeyId(next);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Text cleanup</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm font-medium normal-case">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-1">
                        <Label htmlFor={enableId}>Enable text cleanup</Label>
                        <p className="text-xs text-muted-foreground">
                            Removes speech fillers before pasting.
                        </p>
                    </div>
                    <Switch
                        id={enableId}
                        checked={enabled}
                        disabled={
                            !loaded || saving || keys.length === 0 || (!enabled && !selectedKeyId)
                        }
                        onCheckedChange={(value) => void handleEnabledChange(value)}
                    />
                </div>
                {keys.length > 0 ? (
                    <div className="flex flex-col gap-2">
                        <Label htmlFor={keyId}>OpenAI API key</Label>
                        <Select
                            id={keyId}
                            value={selectedKeyId}
                            disabled={!loaded || saving}
                            onChange={(event) => void handleKeyChange(event.target.value)}
                        >
                            <option value="" disabled>
                                Select an OpenAI API key
                            </option>
                            {keys.map((key) => (
                                <option key={key.id} value={key.id}>
                                    {key.nickname}
                                </option>
                            ))}
                        </Select>
                    </div>
                ) : (
                    loaded && (
                        <p className="text-xs text-muted-foreground">
                            Add an OpenAI API key first to enable text cleanup.
                        </p>
                    )
                )}
                {error && (
                    <p className="text-xs font-bold text-red-700" role="alert">
                        Could not save text cleanup settings: {error}
                    </p>
                )}
                <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    When enabled, bluemacaw sends each completed transcript to OpenAI for cleanup.
                    The original audio is not sent again, and cleanup failures paste the raw
                    transcript instead.
                </p>
            </CardContent>
        </Card>
    );
}
