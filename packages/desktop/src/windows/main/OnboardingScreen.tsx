import { Card } from '@/components/ui/card';
import { type ApiKeyRow, listApiKeys } from '@/lib/db';
import { markOnboardingCompleted } from '@/lib/onboarding';
import {
    hasAllPermissionsSet,
    hasApiKeySet,
    hasHotkeysConfigured,
    hasLocalModelSet,
    hasModelConfigSet,
} from '@/lib/onboarding-silent-skip';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useState } from 'react';
import { OnboardingStepChooseModelSource } from './onboarding/OnboardingStepChooseModelSource';
import { OnboardingStepFirstApiKey } from './onboarding/OnboardingStepFirstApiKey';
import { OnboardingStepFirstModel } from './onboarding/OnboardingStepFirstModel';
import { OnboardingStepHotkeys } from './onboarding/OnboardingStepHotkeys';
import { OnboardingStepLocalModel } from './onboarding/OnboardingStepLocalModel';
import { OnboardingStepPermissions } from './onboarding/OnboardingStepPermissions';

interface OnboardingScreenProps {
    onComplete: () => void;
}

type Step = 1 | 2 | '3a' | '3b' | '3c';

interface Predicates {
    permissions: boolean;
    hotkeys: boolean;
    modelSource: boolean;
    apiKey: boolean;
    modelConfig: boolean;
    localModel: boolean;
}

const STEP_ORDER: ReadonlyArray<Step> = [1, 2, '3a', '3b', '3c'];

function predicateForStep(s: Step, p: Predicates): boolean {
    if (s === 1) return p.permissions;
    if (s === 2) return p.hotkeys;
    if (s === '3a') return p.modelSource;
    if (s === '3b') return p.apiKey || p.localModel;
    if (s === '3c') return p.localModel || (p.apiKey && p.modelConfig);
    return false;
}

function firstUnsatisfied(p: Predicates): Step | null {
    for (const s of STEP_ORDER) if (!predicateForStep(s, p)) return s;
    return null;
}

function nextNeededStep(after: Step, p: Predicates): Step | null {
    const start = STEP_ORDER.indexOf(after) + 1;
    for (let i = start; i < STEP_ORDER.length; i++) {
        const candidate = STEP_ORDER[i];
        if (candidate !== undefined && !predicateForStep(candidate, p)) return candidate;
    }
    return null;
}

function linearNextStep(after: Step): Step | null {
    const idx = STEP_ORDER.indexOf(after);
    return STEP_ORDER[idx + 1] ?? null;
}

type IndicatorState = 'completed' | 'active' | 'pending';
interface IndicatorItem {
    key: string;
    label: string;
    state: IndicatorState;
}

const INDICATOR_KEYS: ReadonlyArray<{ key: string; label: string; step: Step }> = [
    { key: 'permissions', label: 'Permissions', step: 1 },
    { key: 'hotkeys', label: 'Hotkeys', step: 2 },
    { key: 'model-source', label: 'Source', step: '3a' },
    { key: 'model', label: 'Model', step: '3b' },
];

function buildIndicators(step: Step): IndicatorItem[] {
    const activeIdx = STEP_ORDER.indexOf(step);
    return INDICATOR_KEYS.map((item, i) => ({
        key: item.key,
        label: item.label,
        state: i < activeIdx ? 'completed' : i === activeIdx ? 'active' : 'pending',
    }));
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
    const [loading, setLoading] = useState(true);
    const [step, setStep] = useState<Step | null>(null);
    const [predicates, setPredicates] = useState<Predicates>({
        permissions: false,
        hotkeys: false,
        modelSource: false,
        apiKey: false,
        modelConfig: false,
        localModel: false,
    });
    const [keyForModelStep, setKeyForModelStep] = useState<{
        apiKeyId: string;
        providerId: string;
    } | null>(null);
    const [existingApiKeys, setExistingApiKeys] = useState<ApiKeyRow[]>([]);
    const [userBacktracked, setUserBacktracked] = useState(false);
    const [choseLocalPath, setChoseLocalPath] = useState(false);

    const finish = useCallback(async () => {
        try {
            await markOnboardingCompleted();
        } catch (e) {
            console.error('markOnboardingCompleted failed', e);
        }
        onComplete();
    }, [onComplete]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const [permissions, hotkeys, apiKey, modelConfig, localModel] = await Promise.all([
                hasAllPermissionsSet(),
                hasHotkeysConfigured(),
                hasApiKeySet(),
                hasModelConfigSet(),
                hasLocalModelSet(),
            ]);
            if (cancelled) return;
            const next: Predicates = {
                permissions,
                hotkeys,
                modelSource: localModel || apiKey,
                apiKey,
                modelConfig,
                localModel,
            };
            setPredicates(next);
            if (apiKey) {
                try {
                    const keys = await listApiKeys();
                    if (cancelled) return;
                    setExistingApiKeys(keys);
                    const first = keys[0];
                    if (first) {
                        setKeyForModelStep({
                            apiKeyId: first.id,
                            providerId: first.providerId,
                        });
                    }
                } catch (e) {
                    console.error('OnboardingScreen: listApiKeys failed', e);
                }
            }
            const target = firstUnsatisfied(next);
            setLoading(false);
            if (target === null) {
                void finish();
                return;
            }
            if (target === '3b') {
                setChoseLocalPath(!!localModel);
            }
            setStep(target);
        })();
        return () => {
            cancelled = true;
        };
    }, [finish]);

    const advanceAfter = useCallback(
        (completed: Step, nextPredicates: Predicates) => {
            const target = userBacktracked
                ? linearNextStep(completed)
                : nextNeededStep(completed, nextPredicates);
            if (target === null) {
                void finish();
                return;
            }
            if (target === '3b' && completed !== '3a') {
                setChoseLocalPath(!!nextPredicates.localModel);
            }
            setStep(target);
        },
        [finish, userBacktracked],
    );

    const handlePermissionsNext = useCallback(() => {
        const next: Predicates = { ...predicates, permissions: true };
        setPredicates(next);
        advanceAfter(1, next);
    }, [predicates, advanceAfter]);

    const handleHotkeysNext = useCallback(() => {
        const next: Predicates = { ...predicates, hotkeys: true };
        setPredicates(next);
        advanceAfter(2, next);
    }, [predicates, advanceAfter]);

    const handleChooseCloud = useCallback(() => {
        const next: Predicates = { ...predicates, modelSource: true };
        setPredicates(next);
        setChoseLocalPath(false);
        advanceAfter('3a', next);
    }, [predicates, advanceAfter]);

    const handleChooseLocal = useCallback(() => {
        const next: Predicates = { ...predicates, modelSource: true };
        setPredicates(next);
        setChoseLocalPath(true);
        advanceAfter('3a', next);
    }, [predicates, advanceAfter]);

    const handleApiKeySaved = useCallback(
        (saved: ApiKeyRow) => {
            setKeyForModelStep({ apiKeyId: saved.id, providerId: saved.providerId });
            setExistingApiKeys((prev) => [...prev, saved]);
            const next: Predicates = { ...predicates, apiKey: true };
            setPredicates(next);
            advanceAfter('3b', next);
        },
        [predicates, advanceAfter],
    );

    if (loading || step === null) {
        return (
            <main
                className="flex min-h-screen items-center justify-center bg-bg text-fg"
                data-testid="onboarding-screen"
            >
                <p className="text-sm text-muted-foreground" data-testid="onboarding-loading">
                    Setting up…
                </p>
            </main>
        );
    }

    const indicators = buildIndicators(step);
    const goBack = (target: Step) => {
        setUserBacktracked(true);
        setStep(target);
    };
    const goBackToPermissions = () => goBack(1);
    const goBackToModelSource = () => goBack('3a');
    const goBackToApiKey = () => goBack('3b');

    return (
        <main className="min-h-screen bg-bg px-6 py-10 text-fg" data-testid="onboarding-screen">
            <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
                <header className="flex flex-col items-center gap-3 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-pill bg-brand-blue/10 text-brand-blue shadow-card dark:bg-main/20 dark:text-main-foreground">
                        <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            fill="none"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-6 w-6 stroke-current"
                        >
                            <rect x="9" y="3" width="6" height="12" rx="3" />
                            <path d="M5 11a7 7 0 0 0 14 0" />
                            <path d="M12 18v3" />
                        </svg>
                    </span>
                    <h1 className="text-2xl font-extrabold tracking-tight">Welcome to bluemacaw</h1>
                    <p className="max-w-sm text-sm text-muted-foreground">
                        Four quick steps: permissions, hotkeys, choose your model source, and
                        configure it.
                    </p>
                    <ol
                        className="flex flex-row items-center gap-2 pt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
                        data-testid="onboarding-progress"
                    >
                        {indicators.map((item, i) => (
                            <li key={item.key} className="flex items-center gap-2">
                                {i > 0 && <span aria-hidden="true">·</span>}
                                <span
                                    data-testid={`onboarding-progress-${item.key}`}
                                    data-active={item.state === 'active' ? 'true' : 'false'}
                                    className={cn(
                                        'flex items-center gap-1.5',
                                        item.state === 'active' && 'text-fg',
                                        item.state === 'completed' &&
                                            'text-brand-blue dark:text-main-foreground',
                                    )}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={cn(
                                            'inline-block h-1.5 w-1.5 rounded-full',
                                            item.state === 'active'
                                                ? 'bg-fg'
                                                : item.state === 'completed'
                                                  ? 'bg-brand-blue dark:bg-main-foreground'
                                                  : 'bg-muted-foreground/40',
                                        )}
                                    />
                                    {item.label}
                                </span>
                            </li>
                        ))}
                    </ol>
                </header>

                <section className="rounded-3xl border border-border bg-surface p-6 shadow-card">
                    {step === 1 && <OnboardingStepPermissions onNext={handlePermissionsNext} />}
                    {step === 2 && (
                        <OnboardingStepHotkeys
                            onBack={goBackToPermissions}
                            onNext={handleHotkeysNext}
                        />
                    )}
                    {step === '3a' && (
                        <OnboardingStepChooseModelSource
                            onChooseCloud={handleChooseCloud}
                            onChooseLocal={handleChooseLocal}
                            onSkipFinish={() => void finish()}
                        />
                    )}
                    {step === '3b' && !choseLocalPath && (
                        <OnboardingStepFirstApiKey
                            onBack={goBackToModelSource}
                            existingKeys={existingApiKeys}
                            onSaved={handleApiKeySaved}
                            onContinueExisting={
                                keyForModelStep
                                    ? () => {
                                          const next: Predicates = {
                                              ...predicates,
                                              apiKey: true,
                                          };
                                          setPredicates(next);
                                          advanceAfter('3b', next);
                                      }
                                    : undefined
                            }
                            onSkipFinish={() => void finish()}
                        />
                    )}
                    {step === '3b' && choseLocalPath && (
                        <OnboardingStepLocalModel
                            onBack={goBackToModelSource}
                            onSkipFinish={() => void finish()}
                            onFinish={() => void finish()}
                        />
                    )}
                    {step === '3c' &&
                        (keyForModelStep ? (
                            <OnboardingStepFirstModel
                                apiKeyId={keyForModelStep.apiKeyId}
                                providerId={keyForModelStep.providerId}
                                onBack={goBackToApiKey}
                                onFinish={() => void finish()}
                            />
                        ) : (
                            <Card className="p-4">
                                <p className="text-sm text-muted-foreground">
                                    No API key available; finishing onboarding.
                                </p>
                            </Card>
                        ))}
                </section>
            </div>
        </main>
    );
}
