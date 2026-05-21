import { HotkeyInput } from '@/components/HotkeyInput';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { autostart } from '@/lib/autostart';
import {
    clearOriginalFnUsageType,
    getCancelHotkeyCombo,
    getHotkeyCombo,
    getOriginalFnUsageType,
    setCancelHotkeyCombo,
    setHotkeyCombo,
    setHotkeysOnboarded,
    setOriginalFnUsageType,
} from '@/lib/db';
import { vox } from '@/lib/invoke';
import { ERR_ACCESSIBILITY_REQUIRED } from '@/lib/markers';
import { useEffect, useId, useState } from 'react';

interface OnboardingStepHotkeysProps {
    /** Hidden when omitted — the shell only passes this prop when there's a
     * preceding not-yet-satisfied step to go back to. */
    onBack?: () => void;
    /** Called after both hotkeys have been persisted and registered. */
    onNext: () => void;
}

const FN_USAGE_LABEL: Record<number, string> = {
    0: 'Do Nothing',
    1: 'Change Input Source',
    2: 'Show Emoji & Symbols',
    3: 'Start Dictation',
};

function fnUsageLabel(value: number): string {
    return FN_USAGE_LABEL[value] ?? `Unknown (${value})`;
}

function isFnCombo(combo: string): boolean {
    return combo.trim().toLowerCase() === 'fn';
}

export function OnboardingStepHotkeys({ onBack, onNext }: OnboardingStepHotkeysProps) {
    const hotkeyId = useId();
    const cancelHotkeyId = useId();
    const autostartId = useId();
    const [hotkey, setHotkey] = useState<string>('');
    const [cancelHotkey, setCancelHotkey] = useState<string>('');
    const [autostartEnabled, setAutostartEnabled] = useState(false);
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);
    const [hotkeyError, setHotkeyError] = useState<string | null>(null);
    const [cancelHotkeyError, setCancelHotkeyError] = useState<string | null>(null);
    const [autostartError, setAutostartError] = useState<string | null>(null);
    /**
     * When non-null, the user clicked "Use Fn" but the macOS
     * `AppleFnUsageType` setting is something other than 0 ("Do Nothing").
     * We surface a confirmation panel before mutating a global system
     * setting. `previous` is stashed so we can restore it on revert.
     */
    const [pendingFnSetup, setPendingFnSetup] = useState<{ previous: number } | null>(null);

    useEffect(() => {
        void (async () => {
            const [persistedHotkey, persistedCancelHotkey] = await Promise.all([
                getHotkeyCombo(),
                getCancelHotkeyCombo(),
            ]);
            setHotkey(persistedHotkey);
            setCancelHotkey(persistedCancelHotkey);
            // Read current OS autostart state separately — its failure
            // mode (e.g. unsupported platform) must not block the rest
            // of the form from rendering.
            try {
                setAutostartEnabled(await autostart.isEnabled());
            } catch (e) {
                console.error('autostart.isEnabled failed', e);
            }
            setReady(true);
        })();
    }, []);

    async function handleAutostartToggle(next: boolean) {
        // Optimistic flip so the switch feels immediate; revert + surface
        // an inline error if the OS write fails (e.g. sandbox denies the
        // Login Item write or osascript times out on macOS).
        const previous = autostartEnabled;
        setAutostartEnabled(next);
        setAutostartError(null);
        try {
            await autostart.set(next);
        } catch (e) {
            console.error('autostart.set failed', e);
            setAutostartEnabled(previous);
            setAutostartError(e instanceof Error ? e.message : String(e));
        }
    }

    // Free the OS-level shortcut so the webview can see the keydown the
    // user is about to press during capture. We re-register the previous
    // combo if the user cancels, or the new one once they commit (Next).
    async function handleCaptureStart() {
        try {
            await vox.unregisterHotkey();
        } catch (e) {
            console.error('unregister_hotkey failed', e);
        }
    }
    async function handleCaptureCancel() {
        try {
            await vox.registerHotkey(hotkey);
        } catch (e) {
            console.error('restore registerHotkey failed', e);
        }
    }
    function handleCancelHotkeyCaptureStart() {
        // The cancel hotkey is not persistently registered (its lifecycle
        // is bound to the recording window), so nothing to release here.
    }
    function handleCancelHotkeyCaptureCancel() {
        // No-op: nothing to restore.
    }

    /**
     * Commit Fn as the start/stop hotkey: persist + register immediately so
     * the user gets fast feedback (especially for the Accessibility-required
     * path) instead of discovering the failure on Next. Mirrors the
     * SettingsRecording Fn flow.
     */
    async function commitFnHotkey() {
        setHotkey('Fn');
        await setHotkeyCombo('Fn');
        try {
            await vox.registerHotkey('Fn');
            setHotkeyError(null);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('register_hotkey Fn failed', e);
            if (msg.includes(ERR_ACCESSIBILITY_REQUIRED)) {
                setHotkeyError(
                    'Fn needs Accessibility permission. Grant bluemacaw in System Settings, then click Use Fn again.',
                );
                try {
                    await vox.requestAccessibilityPermission();
                } catch {
                    // requestAccessibilityPermission already opens Settings; the inline
                    // error remains visible if it throws.
                }
            } else {
                setHotkeyError(msg);
            }
        }
    }

    async function handleUseFnRequested() {
        setHotkeyError(null);
        try {
            const current = await vox.getFnUsageType();
            if (current === null || current === 0) {
                await commitFnHotkey();
                return;
            }
            setPendingFnSetup({ previous: current });
        } catch (e) {
            setHotkeyError(e instanceof Error ? e.message : String(e));
        }
    }

    async function handleConfirmFnSetup() {
        if (!pendingFnSetup) return;
        try {
            // Stash the original BEFORE flipping the system setting, so a
            // crash mid-flow leaves us a row we can restore from on next
            // launch (mirrors SettingsRecording behavior).
            await setOriginalFnUsageType(pendingFnSetup.previous);
            await vox.setFnUsageType(0);
            setPendingFnSetup(null);
            await commitFnHotkey();
        } catch (e) {
            setHotkeyError(e instanceof Error ? e.message : String(e));
        }
    }

    function handleCancelFnSetup() {
        setPendingFnSetup(null);
    }

    async function handleNext() {
        setSaving(true);
        setHotkeyError(null);
        setCancelHotkeyError(null);
        try {
            // If the user committed Fn earlier in this step and then captured
            // a different combo, restore the AppleFnUsageType we stashed so
            // we don't leave a global system setting in our state forever.
            if (!isFnCombo(hotkey)) {
                try {
                    const original = await getOriginalFnUsageType();
                    if (original !== null) {
                        await vox.setFnUsageType(original);
                        await clearOriginalFnUsageType();
                    }
                } catch (e) {
                    console.error('restore AppleFnUsageType on hotkey switch failed', e);
                }
            }
            await setHotkeyCombo(hotkey);
            try {
                await vox.registerHotkey(hotkey);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('register_hotkey failed', e);
                setHotkeyError(msg);
                return;
            }
            await setCancelHotkeyCombo(cancelHotkey);
            try {
                // Validate parsing only — the recording loop owns the
                // actual global registration when a recording starts.
                await vox.validateCancelHotkey(cancelHotkey);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('validate_cancel_hotkey failed', e);
                setCancelHotkeyError(msg);
                return;
            }
            try {
                await setHotkeysOnboarded(true);
            } catch (e) {
                console.error('setHotkeysOnboarded failed', e);
            }
            onNext();
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="flex flex-col gap-6" data-testid="onboarding-step-hotkeys">
            <div className="flex flex-col gap-1">
                <h2 className="text-lg font-extrabold tracking-tight">Hotkeys</h2>
                <p className="text-sm text-muted-foreground">
                    Pick the shortcuts you'll press to start/stop a recording and to cancel an
                    in-progress one. We've filled in sensible defaults — click Next if you don't
                    want to change them.
                </p>
            </div>

            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <Label htmlFor={hotkeyId}>Start / stop recording</Label>
                    <div id={hotkeyId}>
                        {ready && (
                            <HotkeyInput
                                value={hotkey}
                                onChange={setHotkey}
                                onCaptureStart={() => void handleCaptureStart()}
                                onCaptureCancel={() => void handleCaptureCancel()}
                                onUseFnRequested={() => void handleUseFnRequested()}
                            />
                        )}
                    </div>
                    {hotkeyError && (
                        <p
                            data-testid="onboarding-hotkey-error"
                            className="text-xs font-bold uppercase tracking-widest text-red-700"
                        >
                            {hotkeyError}
                        </p>
                    )}
                    {pendingFnSetup && (
                        <div
                            data-testid="onboarding-fn-setup-confirm"
                            className="flex flex-col gap-2 border-3 border-border bg-yellow-100 p-3 text-xs leading-relaxed text-fg"
                        >
                            <p>
                                To use Fn, macOS needs <strong>Press 🌐 key to</strong> set to{' '}
                                <strong>Do Nothing</strong> (currently:{' '}
                                <strong>{fnUsageLabel(pendingFnSetup.previous)}</strong>). This is a
                                global system setting. bluemacaw will restore your original value
                                automatically when you switch away from Fn.
                            </p>
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={handleCancelFnSetup}>
                                    Cancel
                                </Button>
                                <Button size="sm" onClick={() => void handleConfirmFnSetup()}>
                                    Set automatically
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor={cancelHotkeyId}>Cancel recording</Label>
                    <div id={cancelHotkeyId}>
                        {ready && (
                            <HotkeyInput
                                value={cancelHotkey}
                                onChange={setCancelHotkey}
                                onCaptureStart={handleCancelHotkeyCaptureStart}
                                onCaptureCancel={handleCancelHotkeyCaptureCancel}
                                allowFn={false}
                                allowBareKey={true}
                                allowChord={false}
                            />
                        )}
                    </div>
                    {cancelHotkeyError && (
                        <p
                            data-testid="onboarding-cancel-hotkey-error"
                            className="text-xs font-bold uppercase tracking-widest text-red-700"
                        >
                            {cancelHotkeyError}
                        </p>
                    )}
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/30 p-3">
                    <div className="flex flex-col gap-0.5 pr-3">
                        <Label htmlFor={autostartId} className="cursor-pointer">
                            Start bluemacaw at login
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            Launch automatically into the tray when you sign in. You can change this
                            later in Settings → Recording.
                        </p>
                    </div>
                    <Switch
                        id={autostartId}
                        data-testid="onboarding-autostart-toggle"
                        checked={autostartEnabled}
                        onCheckedChange={(v: boolean) => void handleAutostartToggle(v)}
                    />
                </div>
                {autostartError && (
                    <p
                        data-testid="onboarding-autostart-error"
                        className="text-xs font-bold uppercase tracking-widest text-red-700"
                    >
                        {autostartError}
                    </p>
                )}
                <p className="text-xs text-muted-foreground">
                    Per-mic selection lives in Settings → Recording after onboarding.
                </p>
            </div>

            <div className="flex flex-row items-center justify-between gap-2 pt-2">
                {onBack ? (
                    <Button variant="ghost" size="sm" onClick={onBack} data-testid="hotkeys-back">
                        Back
                    </Button>
                ) : (
                    <span />
                )}
                <Button
                    disabled={!ready || saving || !hotkey || !cancelHotkey}
                    onClick={() => void handleNext()}
                    data-testid="hotkeys-next"
                >
                    {saving ? 'Saving…' : 'Next'}
                </Button>
            </div>
        </div>
    );
}
