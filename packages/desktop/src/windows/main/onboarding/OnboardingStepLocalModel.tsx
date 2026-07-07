import { Button } from '@/components/ui/button';
import { setActiveLocalModelId } from '@/lib/db';
import { vox } from '@/lib/invoke';
import { DEFAULT_LOCAL_MODELS } from '@/providers/local';
import { useState } from 'react';

interface OnboardingStepLocalModelProps {
    onFinish: () => void;
    onBack: () => void;
    onSkipFinish: () => void;
}

export function OnboardingStepLocalModel({
    onFinish,
    onBack,
    onSkipFinish,
}: OnboardingStepLocalModelProps) {
    const [selected, setSelected] = useState('ggml-medium.en');
    const [downloading, setDownloading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleDownload() {
        setError(null);
        setDownloading(true);
        try {
            await vox.downloadWhisperModel(selected);
            await setActiveLocalModelId(selected);
            onFinish();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setDownloading(false);
        }
    }

    return (
        <div className="flex flex-col gap-6" data-testid="onboarding-step-local-model">
            <div className="flex flex-col gap-1">
                <h2 className="text-lg font-extrabold tracking-tight">Download a local model</h2>
                <p className="text-sm text-muted-foreground">
                    Download a Whisper GGML model to run entirely on your device. The options below
                    are popular sizes from{' '}
                    <a
                        href="https://huggingface.co/ggerganov/whisper.cpp"
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-main hover:underline"
                    >
                        ggerganov/whisper.cpp
                    </a>{' '}
                    on Hugging Face — larger models are more accurate but need more disk space.
                    These five are just a starting point; you can download any Whisper GGML model
                    from the repo later in Settings.
                </p>
            </div>

            <div className="flex flex-col gap-2">
                {DEFAULT_LOCAL_MODELS.map((m) => (
                    <label
                        key={m.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${
                            selected === m.id
                                ? 'border-brand-blue bg-brand-blue/5'
                                : 'border-border'
                        }`}
                    >
                        <input
                            type="radio"
                            name="local-model-size"
                            value={m.id}
                            checked={selected === m.id}
                            onChange={() => setSelected(m.id)}
                            disabled={downloading}
                        />
                        <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-bold">{m.displayName}</span>
                            <span className="font-mono text-xs text-muted-foreground">{m.id}</span>
                            <span className="text-xs text-muted-foreground">{m.description}</span>
                        </div>
                    </label>
                ))}
            </div>

            {error && (
                <p className="text-sm text-red-600" role="alert" data-testid="local-model-error">
                    {error}
                </p>
            )}

            <div className="flex items-center justify-between gap-2 pt-2">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onBack}
                    disabled={downloading}
                    data-testid="local-model-back"
                >
                    Back
                </Button>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        onClick={onSkipFinish}
                        disabled={downloading}
                        data-testid="local-model-skip"
                    >
                        I'll do it later
                    </Button>
                    <Button
                        onClick={() => void handleDownload()}
                        disabled={downloading}
                        data-testid="local-model-download"
                    >
                        {downloading ? 'Downloading…' : 'Download & finish'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
