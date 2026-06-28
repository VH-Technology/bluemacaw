import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { addModelConfig } from '@/lib/db';
import { PROVIDERS } from '@/providers';
import { useMemo, useState } from 'react';
import { ModelPicker } from '../ModelPicker';

interface OnboardingStepFirstModelProps {
    /** Hidden when omitted — the shell only passes this prop when there's a
     * preceding not-yet-satisfied step to go back to. */
    onBack?: () => void;
    /** Called after the model config has been inserted (or the user chose
     * to skip). Wizard shell handles `markOnboardingCompleted` + onComplete. */
    onFinish: () => void;
    /** The API key the new model config should attach to. */
    apiKeyId: string;
    /** Provider id of that key — drives the model dropdown contents. */
    providerId: string;
}

export function OnboardingStepFirstModel({
    onBack,
    onFinish,
    apiKeyId,
    providerId,
}: OnboardingStepFirstModelProps) {
    const provider = useMemo(() => PROVIDERS.find((p) => p.id === providerId), [providerId]);
    const models = provider?.defaultModels ?? [];
    const [selectedModel, setSelectedModel] = useState<string>(models[0]?.id ?? '');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function handleFinish() {
        setError(null);
        if (!selectedModel) {
            setError('Pick a model to continue.');
            return;
        }
        setBusy(true);
        try {
            await addModelConfig({ apiKeyId, modelId: selectedModel });
            onFinish();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="flex flex-col gap-6" data-testid="onboarding-step-first-model">
            <div className="flex flex-col gap-1">
                <h2 className="text-lg font-extrabold tracking-tight">Pick a model</h2>
                <p className="text-sm text-muted-foreground">
                    {provider
                        ? `Choose the ${provider.name} model bluemacaw should use by default. You can swap it (and add more) in Settings later.`
                        : 'Choose a model for bluemacaw to use by default. You can swap it later in Settings.'}
                </p>
            </div>

            <div className="flex flex-col gap-3 text-sm font-medium normal-case">
                <div className="flex flex-col gap-2">
                    <Label>Model</Label>
                    <ModelPicker
                        models={models}
                        selectedModelId={selectedModel}
                        onSelect={setSelectedModel}
                        providerId={provider?.id}
                        disabled={models.length === 0}
                    />
                </div>
                {error && (
                    <p
                        className="text-xs font-bold text-red-700"
                        role="alert"
                        data-testid="onboarding-model-error"
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
                        data-testid="first-model-back"
                    >
                        Back
                    </Button>
                ) : (
                    <span />
                )}
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={onFinish} data-testid="first-model-skip">
                        I'll do it later
                    </Button>
                    <Button
                        onClick={() => void handleFinish()}
                        disabled={busy || !selectedModel}
                        data-testid="first-model-finish"
                    >
                        {busy ? 'Saving…' : 'Save & finish'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
