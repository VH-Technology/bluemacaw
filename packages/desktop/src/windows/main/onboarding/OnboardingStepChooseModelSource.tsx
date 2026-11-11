import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface OnboardingStepChooseModelSourceProps {
    onChooseCloud: () => void;
    onChooseLocal: () => void;
    onSkipFinish: () => void;
}

export function OnboardingStepChooseModelSource({
    onChooseCloud,
    onChooseLocal,
    onSkipFinish,
}: OnboardingStepChooseModelSourceProps) {
    return (
        <div className="flex flex-col gap-6" data-testid="onboarding-step-choose-model-source">
            <div className="flex flex-col gap-1">
                <h2 className="text-lg font-extrabold tracking-tight">Choose your model</h2>
                <p className="text-sm text-muted-foreground">
                    You can use a cloud provider with an API key, or download a model to run
                    entirely on your device — no internet needed after the download.
                </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <Card
                    data-testid="choose-cloud"
                    className="flex cursor-pointer flex-col items-center gap-3 p-6 transition-colors hover:border-brand-blue hover:bg-brand-blue/5"
                    onClick={onChooseCloud}
                >
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="h-10 w-10 stroke-brand-blue"
                    >
                        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                    </svg>
                    <span className="text-sm font-bold">Cloud provider</span>
                    <span className="text-center text-xs text-muted-foreground">
                        Use OpenAI, Deepgram, etc. Requires an API key.
                    </span>
                </Card>

                <Card
                    data-testid="choose-local"
                    className="flex cursor-pointer flex-col items-center gap-3 p-6 transition-colors hover:border-brand-blue hover:bg-brand-blue/5"
                    onClick={onChooseLocal}
                >
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="h-10 w-10 stroke-brand-blue"
                    >
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        <rect x="9" y="9" width="6" height="6" />
                        <line x1="9" y1="1" x2="9" y2="4" />
                        <line x1="15" y1="1" x2="15" y2="4" />
                        <line x1="9" y1="20" x2="9" y2="23" />
                        <line x1="15" y1="20" x2="15" y2="23" />
                        <line x1="20" y1="9" x2="23" y2="9" />
                        <line x1="20" y1="14" x2="23" y2="14" />
                        <line x1="1" y1="9" x2="4" y2="9" />
                        <line x1="1" y1="14" x2="4" y2="14" />
                    </svg>
                    <span className="text-sm font-bold">Local (on-device)</span>
                    <span className="text-center text-xs text-muted-foreground">
                        Download and run locally. Free, private, no internet needed.
                    </span>
                </Card>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="outline" onClick={onSkipFinish} data-testid="choose-source-skip">
                    I'll do it later
                </Button>
            </div>
        </div>
    );
}
