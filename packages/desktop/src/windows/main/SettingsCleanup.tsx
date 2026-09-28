import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DEFAULT_TRANSCRIPT_CLEANUP_OPTIONS } from '@/lib/cleanup-config';
import {
    type ApiKeyRow,
    getTranscriptCleanupApiKeyId,
    getTranscriptCleanupOptions,
    listApiKeys,
    setTranscriptCleanupApiKeyId,
    setTranscriptCleanupOptions,
} from '@/lib/db';
import { useEffect, useId, useState } from 'react';

interface SettingsCleanupProps {
    refreshToken?: number;
}

function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}

export function SettingsCleanup({ refreshToken }: SettingsCleanupProps) {
    const enableId = useId();
    const keyId = useId();
    const modelIdInputId = useId();
    const promptId = useId();
    const [keys, setKeys] = useState<ApiKeyRow[]>([]);
    const [enabled, setEnabled] = useState(false);
    const [selectedKeyId, setSelectedKeyId] = useState('');
    const [keysLoaded, setKeysLoaded] = useState(false);
    const [optionsLoaded, setOptionsLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [keyLoadError, setKeyLoadError] = useState<string | null>(null);
    const [optionsLoadError, setOptionsLoadError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [modelId, setModelId] = useState(DEFAULT_TRANSCRIPT_CLEANUP_OPTIONS.modelId);
    const [prompt, setPrompt] = useState(DEFAULT_TRANSCRIPT_CLEANUP_OPTIONS.prompt);
    const [savedModelId, setSavedModelId] = useState(DEFAULT_TRANSCRIPT_CLEANUP_OPTIONS.modelId);
    const [savedPrompt, setSavedPrompt] = useState(DEFAULT_TRANSCRIPT_CLEANUP_OPTIONS.prompt);

    useEffect(() => {
        void refreshToken;
        let cancelled = false;
        setKeysLoaded(false);
        setKeyLoadError(null);
        void (async () => {
            try {
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
            } catch (cause) {
                if (!cancelled) {
                    setKeyLoadError(`Could not load text cleanup settings: ${errorMessage(cause)}`);
                }
            } finally {
                if (!cancelled) setKeysLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [refreshToken]);

    useEffect(() => {
        let cancelled = false;
        setOptionsLoaded(false);
        setOptionsLoadError(null);
        void (async () => {
            try {
                const options = await getTranscriptCleanupOptions();
                if (cancelled) return;
                setModelId(options.modelId);
                setPrompt(options.prompt);
                setSavedModelId(options.modelId);
                setSavedPrompt(options.prompt);
            } catch (cause) {
                if (!cancelled) {
                    setOptionsLoadError(
                        `Could not load text cleanup settings: ${errorMessage(cause)}`,
                    );
                }
            } finally {
                if (!cancelled) setOptionsLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    async function handleEnabledChange(next: boolean) {
        if (next && !selectedKeyId) return;
        setSaving(true);
        setSaveError(null);
        try {
            await setTranscriptCleanupApiKeyId(next ? selectedKeyId : null);
            setEnabled(next);
        } catch (cause) {
            setSaveError(`Could not save text cleanup settings: ${errorMessage(cause)}`);
        } finally {
            setSaving(false);
        }
    }

    async function handleKeyChange(next: string) {
        setSaveError(null);
        if (!enabled) {
            setSelectedKeyId(next);
            return;
        }
        setSaving(true);
        try {
            await setTranscriptCleanupApiKeyId(next);
            setSelectedKeyId(next);
        } catch (cause) {
            setSaveError(`Could not save text cleanup settings: ${errorMessage(cause)}`);
        } finally {
            setSaving(false);
        }
    }

    async function handleSaveOptions() {
        const next = { modelId: modelId.trim(), prompt: prompt.trim() };
        if (!next.modelId || !next.prompt) return;
        setSaving(true);
        setSaveError(null);
        try {
            await setTranscriptCleanupOptions(next);
            setModelId(next.modelId);
            setPrompt(next.prompt);
            setSavedModelId(next.modelId);
            setSavedPrompt(next.prompt);
            setOptionsLoadError(null);
        } catch (cause) {
            setSaveError(`Could not save text cleanup settings: ${errorMessage(cause)}`);
        } finally {
            setSaving(false);
        }
    }

    async function handleResetOptions() {
        const defaults = { ...DEFAULT_TRANSCRIPT_CLEANUP_OPTIONS };
        setSaving(true);
        setSaveError(null);
        try {
            await setTranscriptCleanupOptions(defaults);
            setModelId(defaults.modelId);
            setPrompt(defaults.prompt);
            setSavedModelId(defaults.modelId);
            setSavedPrompt(defaults.prompt);
            setOptionsLoadError(null);
        } catch (cause) {
            setSaveError(`Could not save text cleanup settings: ${errorMessage(cause)}`);
        } finally {
            setSaving(false);
        }
    }

    const optionsDirty = modelId !== savedModelId || prompt !== savedPrompt;
    const optionsValid = Boolean(modelId.trim() && prompt.trim());
    const loaded = keysLoaded && optionsLoaded;
    const error = saveError ?? optionsLoadError ?? keyLoadError;

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
                <div className="border-t border-border/70 pt-4">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor={modelIdInputId}>OpenAI model</Label>
                            <Input
                                id={modelIdInputId}
                                list="cleanup-model-suggestions"
                                value={modelId}
                                disabled={!loaded || saving}
                                onChange={(event) => setModelId(event.target.value)}
                            />
                            <datalist id="cleanup-model-suggestions">
                                <option value="gpt-4o-mini" />
                                <option value="gpt-4.1-mini" />
                                <option value="gpt-4.1-nano" />
                            </datalist>
                            <p className="text-xs text-muted-foreground">
                                Any OpenAI Responses-compatible model ID.
                            </p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor={promptId}>Cleanup prompt</Label>
                            <textarea
                                id={promptId}
                                value={prompt}
                                rows={8}
                                disabled={!loaded || saving}
                                onChange={(event) => setPrompt(event.target.value)}
                                className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-fg placeholder:text-muted-foreground focus-visible:border-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                        </div>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!loaded || saving}
                            onClick={() => void handleResetOptions()}
                        >
                            Reset defaults
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            disabled={!loaded || saving || !optionsDirty || !optionsValid}
                            onClick={() => void handleSaveOptions()}
                        >
                            Save cleanup instructions
                        </Button>
                    </div>
                </div>
                {error && (
                    <p className="text-xs font-bold text-red-700" role="alert">
                        {error}
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
