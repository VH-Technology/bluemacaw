import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { WarningBanner } from '@/components/ui/warning-banner';
import {
    DEFAULT_APPLE_INTELLIGENCE_CLEANUP_PROMPT,
    DEFAULT_TRANSCRIPT_CLEANUP_OPTIONS,
    type TranscriptCleanupEngine,
    type TranscriptCleanupOptions,
} from '@/lib/cleanup-config';
import {
    type ApiKeyRow,
    getAppleIntelligenceCleanupEnabled,
    getAppleIntelligenceCleanupPrompt,
    getTranscriptCleanupApiKeyId,
    getTranscriptCleanupOptions,
    listApiKeys,
    setAppleIntelligenceCleanupEnabled,
    setAppleIntelligenceCleanupPrompt,
    setTranscriptCleanupApiKeyId,
    setTranscriptCleanupOptions,
} from '@/lib/db';
import {
    type AppleIntelligenceStatus,
    type AppleIntelligenceUnavailableReason,
    vox,
} from '@/lib/invoke';
import { cn } from '@/lib/utils';
import { useEffect, useId, useState } from 'react';

interface SettingsCleanupProps {
    refreshToken?: number;
}

const ENGINES: { value: TranscriptCleanupEngine; label: string; description: string }[] = [
    {
        value: 'apple-intelligence',
        label: 'On-device',
        description: 'Apple Intelligence on this Mac. Private, free, and works offline.',
    },
    {
        value: 'openai',
        label: 'OpenAI',
        description: 'Cloud model, billed to your OpenAI API key.',
    },
];

/** The on-device engine can never work on this install; don't offer it. */
const OUT_OF_REACH: ReadonlySet<AppleIntelligenceUnavailableReason> = new Set([
    'unsupported-platform',
    'unsupported-os',
    'unsupported-build',
    'device-not-eligible',
]);

/** Conditions that can clear up while the app is open. */
const RECHECKABLE: ReadonlySet<AppleIntelligenceUnavailableReason> = new Set([
    'apple-intelligence-not-enabled',
    'model-not-ready',
    'unknown',
]);

function unavailableHint(reason: AppleIntelligenceUnavailableReason): string {
    switch (reason) {
        case 'apple-intelligence-not-enabled':
            return 'Turn on Apple Intelligence in System Settings → Apple Intelligence & Siri, then check again.';
        case 'model-not-ready':
            return 'Apple Intelligence is still getting ready; its model may still be downloading. Check again in a few minutes.';
        case 'unknown':
            return "Apple Intelligence didn't respond. Check again in a moment.";
        default:
            return "On-device cleanup isn't available on this Mac. Switch to OpenAI or turn cleanup off.";
    }
}

/** The Rust command never rejects; a rejection means the webview couldn't reach it. */
async function probeAppleIntelligence(): Promise<AppleIntelligenceStatus> {
    try {
        return await vox.getAppleIntelligenceStatus();
    } catch {
        return { status: 'unavailable', reason: 'unknown' };
    }
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
    const [openAiEnabled, setOpenAiEnabled] = useState(false);
    const [selectedKeyId, setSelectedKeyId] = useState('');
    const [keysLoaded, setKeysLoaded] = useState(false);
    const [optionsLoaded, setOptionsLoaded] = useState(false);
    const [keyLoadError, setKeyLoadError] = useState<string | null>(null);
    const [optionsLoadError, setOptionsLoadError] = useState<string | null>(null);
    const [modelId, setModelId] = useState(DEFAULT_TRANSCRIPT_CLEANUP_OPTIONS.modelId);
    const [prompt, setPrompt] = useState(DEFAULT_TRANSCRIPT_CLEANUP_OPTIONS.prompt);
    const [savedModelId, setSavedModelId] = useState(DEFAULT_TRANSCRIPT_CLEANUP_OPTIONS.modelId);
    const [savedPrompt, setSavedPrompt] = useState(DEFAULT_TRANSCRIPT_CLEANUP_OPTIONS.prompt);

    const [appleStatus, setAppleStatus] = useState<AppleIntelligenceStatus | null>(null);
    const [checkingApple, setCheckingApple] = useState(false);
    const [appleEnabled, setAppleEnabled] = useState(false);
    const [applePrompt, setApplePrompt] = useState(DEFAULT_APPLE_INTELLIGENCE_CLEANUP_PROMPT);
    const [savedApplePrompt, setSavedApplePrompt] = useState(
        DEFAULT_APPLE_INTELLIGENCE_CLEANUP_PROMPT,
    );
    const [appleLoaded, setAppleLoaded] = useState(false);
    const [appleLoadError, setAppleLoadError] = useState<string | null>(null);

    // Chosen once everything has loaded; null until then so the card doesn't
    // flash one engine's fields before switching to the other.
    const [engine, setEngine] = useState<TranscriptCleanupEngine | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

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
                setOpenAiEnabled(activeKeyExists);
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

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const status = probeAppleIntelligence();
            try {
                const [savedEnabled, savedOnDevicePrompt] = await Promise.all([
                    getAppleIntelligenceCleanupEnabled(),
                    getAppleIntelligenceCleanupPrompt(),
                ]);
                if (!cancelled) {
                    setAppleEnabled(savedEnabled);
                    setApplePrompt(savedOnDevicePrompt);
                    setSavedApplePrompt(savedOnDevicePrompt);
                }
            } catch (cause) {
                if (!cancelled) {
                    setAppleLoadError(
                        `Could not load text cleanup settings: ${errorMessage(cause)}`,
                    );
                }
            }
            const resolved = await status;
            if (cancelled) return;
            setAppleStatus(resolved);
            setAppleLoaded(true);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const appleAvailable = appleStatus?.status === 'available';
    const appleOffered =
        appleStatus !== null &&
        (appleStatus.status === 'available' || !OUT_OF_REACH.has(appleStatus.reason));
    // Keep the picker visible while on-device cleanup is on, even if this Mac
    // can no longer run it, so it can still be switched or turned off.
    const showEngines = appleOffered || appleEnabled;

    useEffect(() => {
        if (engine !== null || !keysLoaded || !appleLoaded) return;
        if (appleEnabled) setEngine('apple-intelligence');
        else if (openAiEnabled) setEngine('openai');
        else setEngine(appleOffered ? 'apple-intelligence' : 'openai');
    }, [engine, keysLoaded, appleLoaded, appleEnabled, openAiEnabled, appleOffered]);

    const onDevice = engine === 'apple-intelligence';
    const enabled = onDevice ? appleEnabled : openAiEnabled;
    const canEnable = onDevice ? appleAvailable : Boolean(selectedKeyId);
    const loaded = keysLoaded && optionsLoaded && appleLoaded && engine !== null;
    // The prompt only applies while cleanup runs, so it's only editable then.
    const locked = !loaded || saving || !enabled;

    async function persist(action: () => Promise<void>) {
        setSaving(true);
        setSaveError(null);
        try {
            await action();
        } catch (cause) {
            setSaveError(`Could not save text cleanup settings: ${errorMessage(cause)}`);
        } finally {
            setSaving(false);
        }
    }

    async function handleEnabledChange(next: boolean) {
        if (next && !canEnable) return;
        await persist(async () => {
            if (onDevice) {
                await setAppleIntelligenceCleanupEnabled(next);
                setAppleEnabled(next);
                if (next) setOpenAiEnabled(false);
            } else {
                await setTranscriptCleanupApiKeyId(next ? selectedKeyId : null);
                setOpenAiEnabled(next);
                if (next) setAppleEnabled(false);
            }
        });
    }

    async function handleEngineChange(next: TranscriptCleanupEngine) {
        if (next === engine) return;
        if (!enabled) {
            setSaveError(null);
            setEngine(next);
            return;
        }
        // Cleanup is on: keep it on with the new engine when that engine is
        // ready, otherwise turn it off rather than leave the old one running.
        await persist(async () => {
            if (next === 'apple-intelligence') {
                if (appleAvailable) {
                    await setAppleIntelligenceCleanupEnabled(true);
                    setAppleEnabled(true);
                } else {
                    await setTranscriptCleanupApiKeyId(null);
                }
                setOpenAiEnabled(false);
            } else {
                if (selectedKeyId) {
                    await setTranscriptCleanupApiKeyId(selectedKeyId);
                    setOpenAiEnabled(true);
                } else {
                    await setAppleIntelligenceCleanupEnabled(false);
                }
                setAppleEnabled(false);
            }
            setEngine(next);
        });
    }

    async function handleKeyChange(next: string) {
        setSaveError(null);
        if (!openAiEnabled) {
            setSelectedKeyId(next);
            return;
        }
        await persist(async () => {
            await setTranscriptCleanupApiKeyId(next);
            setSelectedKeyId(next);
        });
    }

    async function handleRecheckAppleIntelligence() {
        setCheckingApple(true);
        setAppleStatus(await probeAppleIntelligence());
        setCheckingApple(false);
    }

    async function saveOpenAiOptions(next: TranscriptCleanupOptions) {
        await persist(async () => {
            await setTranscriptCleanupOptions(next);
            setModelId(next.modelId);
            setPrompt(next.prompt);
            setSavedModelId(next.modelId);
            setSavedPrompt(next.prompt);
            setOptionsLoadError(null);
        });
    }

    async function saveApplePrompt(next: string) {
        await persist(async () => {
            await setAppleIntelligenceCleanupPrompt(next);
            setApplePrompt(next);
            setSavedApplePrompt(next);
            setAppleLoadError(null);
        });
    }

    function handleSave() {
        if (onDevice) {
            const next = applePrompt.trim();
            if (next) void saveApplePrompt(next);
            return;
        }
        const next = { modelId: modelId.trim(), prompt: prompt.trim() };
        if (next.modelId && next.prompt) void saveOpenAiOptions(next);
    }

    function handleReset() {
        if (onDevice) void saveApplePrompt(DEFAULT_APPLE_INTELLIGENCE_CLEANUP_PROMPT);
        else void saveOpenAiOptions({ ...DEFAULT_TRANSCRIPT_CLEANUP_OPTIONS });
    }

    const dirty = onDevice
        ? applePrompt !== savedApplePrompt
        : modelId !== savedModelId || prompt !== savedPrompt;
    const valid = onDevice ? Boolean(applePrompt.trim()) : Boolean(modelId.trim() && prompt.trim());
    const error = saveError ?? optionsLoadError ?? keyLoadError ?? appleLoadError;

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
                            Rewrites each transcript with your cleanup prompt before pasting.
                        </p>
                    </div>
                    <Switch
                        id={enableId}
                        checked={enabled}
                        disabled={!loaded || saving || (!enabled && !canEnable)}
                        onCheckedChange={(value) => void handleEnabledChange(value)}
                    />
                </div>
                {engine !== null && showEngines && (
                    <fieldset>
                        <legend className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
                            Cleanup engine
                        </legend>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {ENGINES.map((option) => {
                                const selected = option.value === engine;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        aria-pressed={selected}
                                        disabled={!loaded || saving}
                                        onClick={() => void handleEngineChange(option.value)}
                                        className={cn(
                                            'flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40 disabled:cursor-not-allowed disabled:opacity-50',
                                            selected
                                                ? 'border-main bg-main/10 text-fg shadow-card'
                                                : 'border-border bg-muted/30 text-muted-foreground hover:border-main/40 hover:bg-muted hover:text-fg',
                                        )}
                                    >
                                        <span className="text-xs font-extrabold uppercase tracking-[0.14em]">
                                            {option.label}
                                        </span>
                                        <span className="text-xs font-medium">
                                            {option.description}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </fieldset>
                )}
                {onDevice && appleStatus?.status === 'unavailable' && (
                    <WarningBanner data-testid="apple-intelligence-unavailable">
                        <p>{unavailableHint(appleStatus.reason)}</p>
                        {RECHECKABLE.has(appleStatus.reason) && (
                            <div className="flex justify-end">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={checkingApple}
                                    onClick={() => void handleRecheckAppleIntelligence()}
                                >
                                    {checkingApple ? 'Checking…' : 'Check again'}
                                </Button>
                            </div>
                        )}
                    </WarningBanner>
                )}
                {engine === 'openai' &&
                    (keys.length > 0 ? (
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
                    ))}
                {engine !== null && (
                    <div className="border-t border-border/70 pt-4">
                        <div
                            className={cn(
                                'grid gap-4',
                                !onDevice && 'md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]',
                            )}
                        >
                            {!onDevice && (
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor={modelIdInputId}>OpenAI model</Label>
                                    <Input
                                        id={modelIdInputId}
                                        list="cleanup-model-suggestions"
                                        value={modelId}
                                        disabled={locked}
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
                            )}
                            <div className="flex flex-col gap-2">
                                <Label htmlFor={promptId}>Cleanup prompt</Label>
                                <textarea
                                    id={promptId}
                                    value={onDevice ? applePrompt : prompt}
                                    rows={onDevice ? 12 : 8}
                                    disabled={locked}
                                    onChange={(event) =>
                                        onDevice
                                            ? setApplePrompt(event.target.value)
                                            : setPrompt(event.target.value)
                                    }
                                    className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-fg placeholder:text-muted-foreground focus-visible:border-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40 disabled:cursor-not-allowed disabled:opacity-50"
                                />
                            </div>
                        </div>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={locked}
                                onClick={handleReset}
                            >
                                Reset defaults
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                disabled={locked || !dirty || !valid}
                                onClick={handleSave}
                            >
                                Save cleanup instructions
                            </Button>
                        </div>
                    </div>
                )}
                {error && (
                    <p className="text-xs font-bold text-red-700" role="alert">
                        {error}
                    </p>
                )}
                {engine !== null && (
                    <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                        {onDevice
                            ? 'On-device cleanup runs with Apple Intelligence, so transcripts never leave this Mac. If cleanup fails, the raw transcript is pasted instead.'
                            : 'When enabled, bluemacaw sends each completed transcript to OpenAI for cleanup. The original audio is not sent again, and cleanup failures paste the raw transcript instead.'}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
