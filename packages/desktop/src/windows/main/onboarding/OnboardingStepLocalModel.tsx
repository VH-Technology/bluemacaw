import { Button } from '@/components/ui/button';
import { setActiveLocalModelId } from '@/lib/db';
import { vox } from '@/lib/invoke';
import { useState } from 'react';

interface OnboardingStepLocalModelProps {
    onFinish: () => void;
    onBack: () => void;
    onSkipFinish: () => void;
}

const MODELS = [
    { id: 'ggml-tiny.en', label: 'Tiny (English)', desc: '~75 MB — fastest, weakest accuracy' },
    { id: 'ggml-base.en', label: 'Base (English)', desc: '~145 MB — quick drafts' },
    { id: 'ggml-small.en', label: 'Small (English)', desc: '~470 MB — good balance' },
    {
        id: 'ggml-medium.en',
        label: 'Medium (English)',
        desc: '~1.5 GB — best accuracy/speed tradeoff',
    },
    { id: 'ggml-large-v3', label: 'Large v3', desc: '~3 GB — maximum accuracy' },
];

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
                    Pick a Whisper model size. Larger models are more accurate but take longer to
                    download and more disk space. You can download more later in Settings.
                </p>
            </div>

            <div className="flex flex-col gap-2">
                {MODELS.map((m) => (
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
                            <span className="text-sm font-bold">{m.label}</span>
                            <span className="text-xs text-muted-foreground">{m.desc}</span>
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
