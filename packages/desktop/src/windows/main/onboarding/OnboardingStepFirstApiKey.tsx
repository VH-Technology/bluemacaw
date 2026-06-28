import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type ApiKeyRow, addApiKey } from '@/lib/db';
import { PROVIDERS, type ProviderConfig } from '@/providers';
import { providerName } from '@/providers/util';
import { useId, useState } from 'react';
import { ProviderPicker } from '../ProviderPicker';

interface OnboardingStepFirstApiKeyProps {
    /** Hidden when omitted — the shell only passes this prop when there's a
     * preceding not-yet-satisfied step to go back to. */
    onBack?: () => void;
    /** Read-only list of API keys already on this machine. Rendered as an
     * informational panel above the add-form so the user knows what's
     * already configured. Empty by default. */
    existingKeys?: ApiKeyRow[];
    /** Called after the user fills in a new key, it validates, and the row
     * is inserted. The shell advances with this key as the target for sub-
     * step 3b. */
    onSaved: (saved: ApiKeyRow) => void;
    /** Forward path used when the form is empty but an existing API key is
     * already available (the user reached this sub-step via Back from 3b).
     * Hidden when omitted — without it, Next on an empty form is a
     * validation error. */
    onContinueExisting?: () => void;
    /** "I'll do it later" — marks onboarding complete and routes to main. */
    onSkipFinish: () => void;
}

async function validateAgainstProvider(
    provider: ProviderConfig,
    key: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (provider.validateKey) {
        try {
            const ok = await provider.validateKey(key);
            return ok ? { ok: true } : { ok: false, reason: 'Provider rejected this key.' };
        } catch (e) {
            return { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
    }
    if (provider.listModels) {
        try {
            await provider.listModels(key);
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
    }
    return { ok: true };
}

export function OnboardingStepFirstApiKey({
    onBack,
    existingKeys = [],
    onSaved,
    onContinueExisting,
    onSkipFinish,
}: OnboardingStepFirstApiKeyProps) {
    const nicknameId = useId();
    const keyId = useId();
    const defaultProvider = PROVIDERS[0]?.id ?? '';
    const [provider, setProvider] = useState(defaultProvider);
    const [nickname, setNickname] = useState('Personal');
    const [key, setKey] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const trimmedKey = key.trim();
    const trimmedNickname = nickname.trim();
    const isDirty = trimmedKey.length > 0 || trimmedNickname !== 'Personal';

    async function handleNext() {
        setError(null);
        // Empty form + existing key path: advance without saving anything.
        // This is how the user returns to sub-step 3b after coming back to
        // 3a just to review — no input means "use what I already have."
        if (!trimmedKey && onContinueExisting) {
            onContinueExisting();
            return;
        }
        setBusy(true);
        try {
            const config = PROVIDERS.find((p) => p.id === provider);
            if (!config) {
                setError(`Unknown provider: ${provider}`);
                return;
            }
            if (!trimmedNickname) {
                setError('Nickname is required.');
                return;
            }
            if (!trimmedKey) {
                setError('API key is required.');
                return;
            }
            const validation = await validateAgainstProvider(config, trimmedKey);
            if (!validation.ok) {
                setError(`Validation failed: ${validation.reason}`);
                return;
            }
            const saved = await addApiKey({
                providerId: provider,
                nickname: trimmedNickname,
                secret: trimmedKey,
            });
            onSaved(saved);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    const hasExistingKey = existingKeys.length > 0;

    return (
        <div className="flex flex-col gap-6" data-testid="onboarding-step-first-api-key">
            <div className="flex flex-col gap-1">
                <h2 className="text-lg font-extrabold tracking-tight">
                    {hasExistingKey ? 'API keys' : 'Add your first API key'}
                </h2>
                <p className="text-sm text-muted-foreground">
                    {hasExistingKey
                        ? "You've already added the keys below — click Next to keep using them, or fill the form to add another. You can manage all keys in Settings later."
                        : "bluemacaw is bring-your-own-key. Pick a speech-to-text provider and paste an API key — it's stored in your OS keychain, never sent anywhere except the provider you choose. You can add more keys later in Settings."}
                </p>
            </div>

            {hasExistingKey && (
                <div
                    className="flex flex-col gap-2 text-sm font-medium normal-case"
                    data-testid="onboarding-existing-keys"
                >
                    {existingKeys.map((k) => (
                        <div
                            key={k.id}
                            data-testid={`onboarding-existing-key-${k.id}`}
                            className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-4 py-3"
                        >
                            <div>
                                <div className="text-xs font-bold uppercase tracking-widest">
                                    {providerName(k.providerId)}
                                </div>
                                <div className="text-sm">{k.nickname}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex flex-col gap-3 text-sm font-medium normal-case">
                {hasExistingKey && (
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        Add another
                    </p>
                )}
                <div className="flex flex-col gap-2">
                    <Label>Provider</Label>
                    <ProviderPicker
                        providers={PROVIDERS}
                        selectedProviderId={provider}
                        onSelect={setProvider}
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor={nicknameId}>Nickname</Label>
                    <Input
                        id={nicknameId}
                        data-testid="onboarding-nickname-input"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder="Personal, Work, …"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor={keyId}>API key</Label>
                    <Input
                        id={keyId}
                        data-testid="onboarding-key-input"
                        type="password"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                    />
                </div>
                {error && (
                    <p
                        className="text-xs font-bold text-red-700"
                        role="alert"
                        data-testid="onboarding-key-error"
                    >
                        {error}
                    </p>
                )}
            </div>

            <div className="flex flex-row items-center justify-between gap-2 pt-2">
                {onBack ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onBack}
                        data-testid="first-api-key-back"
                    >
                        Back
                    </Button>
                ) : (
                    <span />
                )}
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        onClick={onSkipFinish}
                        data-testid="first-api-key-skip"
                    >
                        I'll do it later
                    </Button>
                    <Button
                        onClick={() => void handleNext()}
                        disabled={busy}
                        data-testid="first-api-key-next"
                    >
                        {busy ? 'Saving…' : isDirty ? 'Save & next' : 'Next'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
