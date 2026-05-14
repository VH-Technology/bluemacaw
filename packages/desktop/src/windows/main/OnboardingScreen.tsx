import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { type PermissionState, vox } from '@/lib/invoke';
import { markOnboardingCompleted } from '@/lib/onboarding';
import type { PermissionKey } from '@/lib/platform';
import { useOnboardingStatus } from '@/lib/use-onboarding-status';
import { cn } from '@/lib/utils';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

interface OnboardingScreenProps {
    /** Called when the user completes or skips onboarding. Parent should
     * route to the main UI. */
    onComplete: () => void;
}

interface RowMeta {
    title: string;
    description: string;
    icon: ReactNode;
}

const ICON_BASE_CLASS = 'h-5 w-5 stroke-current text-brand-blue dark:text-main-foreground';

function MicIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={ICON_BASE_CLASS}
        >
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
        </svg>
    );
}

function AxIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={ICON_BASE_CLASS}
        >
            <circle cx="12" cy="5" r="1.6" />
            <path d="M4 9h16" />
            <path d="M12 9v12" />
            <path d="M9 21l3-6 3 6" />
        </svg>
    );
}

function KeyIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={ICON_BASE_CLASS}
        >
            <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
            <path d="M7 10h0.01M11 10h0.01M15 10h0.01M7 14h10" />
        </svg>
    );
}

const ROW_META: Record<PermissionKey, RowMeta> = {
    microphone: {
        title: 'Microphone',
        description: 'Required to record your speech.',
        icon: <MicIcon />,
    },
    accessibility: {
        title: 'Accessibility',
        description: 'Lets bluemacaw paste transcribed text into the focused app.',
        icon: <AxIcon />,
    },
    'input-monitoring': {
        title: 'Input Monitoring',
        description: 'Lets bluemacaw listen for your Fn-key shortcut.',
        icon: <KeyIcon />,
    },
};

/**
 * Permissions whose grant only takes effect on the *next* process launch.
 * On macOS, TCC does not propagate authorisation changes into a running
 * process, so once we observe a transition Denied/NotDetermined → Granted
 * for any of these we show the user a restart CTA.
 */
const RESTART_REQUIRED: ReadonlySet<PermissionKey> = new Set(['accessibility', 'input-monitoring']);

function statusLabel(state: PermissionState | undefined): string {
    if (state === 'Granted') return 'Granted';
    if (state === 'Denied') return 'Not granted';
    if (state === 'NotDetermined') return 'Not asked';
    return 'Checking…';
}

function statusPillClass(state: PermissionState | undefined): string {
    if (state === 'Granted') {
        return 'bg-brand-mint/30 text-emerald-900 dark:bg-brand-mint/20 dark:text-brand-mint';
    }
    if (state === 'Denied') {
        return 'bg-brand-coral/20 text-rose-900 dark:bg-brand-coral/20 dark:text-brand-coral';
    }
    return 'bg-brand-yellow/25 text-amber-900 dark:bg-brand-yellow/20 dark:text-brand-yellow';
}

async function runGrant(key: PermissionKey, osIsMac: boolean): Promise<void> {
    if (key === 'microphone') {
        await vox.requestMicrophonePermission();
        return;
    }
    if (key === 'accessibility') {
        if (osIsMac) {
            // First try the prompting variant — it raises the native dialog
            // when not yet trusted. If the process is *already* recorded
            // as untrusted (subsequent calls are rate-limited by macOS),
            // fall back to the deep-link.
            const state = await vox.checkAccessibilityPermissionPrompting();
            if (state !== 'Granted') {
                await vox.openSettingsPanel('accessibility');
            }
            return;
        }
        await vox.requestAccessibilityPermission();
        return;
    }
    // input-monitoring
    await vox.requestInputMonitoringPermission();
    if (osIsMac) {
        // macOS does not show the dialog reliably from CGRequestListenEventAccess
        // in every state; deep-link as a backup so the user always lands on
        // the right panel.
        await vox.openSettingsPanel('input-monitoring');
    }
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
    const { loading, platform, permissions, statuses, allGranted, refresh } = useOnboardingStatus();
    const [showSkipConfirm, setShowSkipConfirm] = useState(false);
    /**
     * Tracks which restart-required permissions have transitioned to
     * Granted *while this screen is mounted*. If non-empty, the user must
     * restart bluemacaw for the grant to apply to the running process.
     */
    const [needsRestart, setNeedsRestart] = useState(false);
    // Ref (not state) for previous status — we only need it to detect
    // transitions; mutating it shouldn't trigger re-renders.
    const seenRef = useRef<Partial<Record<PermissionKey, PermissionState>>>({});

    useEffect(() => {
        if (!permissions) return;
        const prev = seenRef.current;
        let flipped = false;
        for (const k of permissions.required) {
            const cur = statuses[k];
            const prevVal = prev[k];
            if (
                RESTART_REQUIRED.has(k) &&
                prevVal !== undefined &&
                prevVal !== 'Granted' &&
                cur === 'Granted'
            ) {
                flipped = true;
            }
            if (cur !== undefined) prev[k] = cur;
        }
        if (flipped) setNeedsRestart(true);
    }, [statuses, permissions]);

    const handleGrant = useCallback(
        async (key: PermissionKey) => {
            // On macOS, TCC does not propagate Accessibility / Input Monitoring
            // grants into a running process — `AXIsProcessTrustedWithOptions`
            // and `CGPreflightListenEventAccess` keep returning Denied until
            // the app is relaunched. Surface the restart CTA the moment the
            // user clicks Grant for one of those, instead of waiting for a
            // Denied → Granted transition that the running process can never
            // observe.
            if (platform?.os === 'macos' && RESTART_REQUIRED.has(key)) {
                setNeedsRestart(true);
            }
            try {
                await runGrant(key, platform?.os === 'macos');
            } catch (e) {
                console.error(`grant ${key} failed`, e);
            }
            // Refresh immediately rather than waiting for the next 1s poll.
            await refresh();
        },
        [platform, refresh],
    );

    const handleSkipConfirm = useCallback(async () => {
        try {
            await markOnboardingCompleted();
        } catch (e) {
            console.error('markOnboardingCompleted failed', e);
        }
        setShowSkipConfirm(false);
        onComplete();
    }, [onComplete]);

    const handleContinue = useCallback(async () => {
        try {
            await markOnboardingCompleted();
        } catch (e) {
            console.error('markOnboardingCompleted failed', e);
        }
        onComplete();
    }, [onComplete]);

    const handleRestart = useCallback(async () => {
        // Mark completed first so a brand-new launch routes straight to the
        // main UI after restart — the user already finished the gestures.
        try {
            await markOnboardingCompleted();
        } catch (e) {
            console.error('markOnboardingCompleted before restart failed', e);
        }
        try {
            await vox.restartApp();
        } catch (e) {
            console.error('restartApp failed', e);
        }
    }, []);

    if (loading || !platform || !permissions) {
        return (
            <main
                className="flex min-h-screen items-center justify-center bg-bg text-fg"
                data-testid="onboarding-loading"
            >
                <p className="text-sm text-muted-foreground">Checking permissions…</p>
            </main>
        );
    }

    const waylandBanner = permissions.informational?.some(
        (i) => i.kind === 'wayland-paste-fallback',
    );

    return (
        <main className="min-h-screen bg-bg px-6 py-10 text-fg" data-testid="onboarding-screen">
            <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
                <header className="flex flex-col items-center gap-2 text-center">
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
                        A few permissions and you're set. We only ask for what your system actually
                        needs.
                    </p>
                </header>

                <section className="flex flex-col gap-3">
                    {permissions.required.map((key) => {
                        const meta = ROW_META[key];
                        const state = statuses[key];
                        const granted = state === 'Granted';
                        return (
                            <Card
                                key={key}
                                data-testid={`perm-row-${key}`}
                                className="flex flex-row items-center gap-4 p-4"
                            >
                                <span
                                    aria-hidden="true"
                                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-blue/10 dark:bg-main/20"
                                >
                                    {meta.icon}
                                </span>
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <h3 className="text-sm font-bold leading-tight">
                                        {meta.title}
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        {meta.description}
                                    </p>
                                </div>
                                <span
                                    data-testid={`perm-status-${key}`}
                                    className={cn(
                                        'inline-flex shrink-0 items-center rounded-pill px-3 py-1 text-[10px] font-bold uppercase tracking-widest',
                                        statusPillClass(state),
                                    )}
                                >
                                    {statusLabel(state)}
                                </span>
                                {!granted && (
                                    <Button
                                        size="sm"
                                        onClick={() => void handleGrant(key)}
                                        data-testid={`perm-grant-${key}`}
                                    >
                                        Grant
                                    </Button>
                                )}
                            </Card>
                        );
                    })}
                </section>

                {waylandBanner && (
                    <Card
                        data-testid="wayland-banner"
                        className="flex flex-row items-start gap-3 bg-brand-yellow/15 p-4 dark:bg-brand-yellow/10"
                    >
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-pill bg-brand-yellow/40 text-amber-900 dark:text-brand-yellow">
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                fill="none"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-3 w-3 stroke-current"
                            >
                                <path d="M12 9v4" />
                                <path d="M12 17h.01" />
                            </svg>
                        </span>
                        <p className="text-xs leading-relaxed text-fg">
                            You're on Wayland. bluemacaw will copy transcribed text to your
                            clipboard automatically — press Ctrl+V to paste, since Wayland blocks
                            synthetic keystrokes.
                        </p>
                    </Card>
                )}

                {needsRestart && (
                    <Card
                        data-testid="restart-banner"
                        className="flex flex-row items-center justify-between gap-3 bg-brand-yellow/20 p-4 dark:bg-brand-yellow/15"
                    >
                        <p className="text-xs leading-relaxed text-fg">
                            Toggle the switch in System Settings, then click Restart. macOS won't
                            tell bluemacaw about the grant until it relaunches — so the row above
                            may still say “Not granted” until then.
                        </p>
                        <Button
                            size="sm"
                            onClick={() => void handleRestart()}
                            data-testid="perm-restart"
                        >
                            Restart
                        </Button>
                    </Card>
                )}

                <footer className="flex flex-row items-center justify-between gap-2 pt-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowSkipConfirm(true)}
                        data-testid="perm-skip"
                    >
                        Skip for now
                    </Button>
                    <Button
                        disabled={!allGranted}
                        onClick={() => void handleContinue()}
                        data-testid="perm-continue"
                    >
                        Continue
                    </Button>
                </footer>
            </div>

            <Dialog open={showSkipConfirm} onOpenChange={(o) => !o && setShowSkipConfirm(false)}>
                <DialogContent data-testid="skip-confirm-dialog">
                    <DialogHeader>
                        <DialogTitle>Skip permissions?</DialogTitle>
                        <DialogDescription>
                            You can grant permissions later in Settings — but recording and paste
                            won't work until you do.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowSkipConfirm(false)}
                            data-testid="skip-cancel"
                        >
                            Cancel
                        </Button>
                        <Button onClick={() => void handleSkipConfirm()} data-testid="skip-confirm">
                            Skip anyway
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    );
}
