import { HotkeyInput } from '@/components/HotkeyInput';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { WarningBanner } from '@/components/ui/warning-banner';
import { autostart } from '@/lib/autostart';
import {
    clearOriginalFnUsageType,
    getCancelHotkeyCombo,
    getHotkeyCombo,
    getOriginalFnUsageType,
    getSelectedMicDeviceId,
    setCancelHotkeyCombo,
    setHotkeyCombo,
    setOriginalFnUsageType,
    setSelectedMicDeviceId,
} from '@/lib/db';
import { type AudioDeviceInfo, vox } from '@/lib/invoke';
import { ERR_ACCESSIBILITY_REQUIRED } from '@/lib/markers';
import { useCallback, useEffect, useId, useState } from 'react';

const FN_USAGE_LABEL: Record<number, string> = {
    0: 'Do Nothing',
    1: 'Change Input Source',
    2: 'Show Emoji & Symbols',
    3: 'Start Dictation',
};

function fnUsageLabel(value: number): string {
    return FN_USAGE_LABEL[value] ?? `Unknown (${value})`;
}

export function SettingsRecording() {
    const hotkeyId = useId();
    const cancelHotkeyId = useId();
    const autostartId = useId();
    const deviceId = useId();
    const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
    const [selectedDevice, setSelectedDevice] = useState<string>('');
    const [hotkey, setHotkey] = useState<string>('');
    const [cancelHotkey, setCancelHotkey] = useState<string>('');
    const [autostartEnabled, setAutostartEnabled] = useState(false);
    const [autostartError, setAutostartError] = useState<string | null>(null);
    const [testStatus, setTestStatus] = useState<'idle' | 'recording' | 'playing' | 'error'>(
        'idle',
    );
    const [testError, setTestError] = useState<string | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [hotkeyError, setHotkeyError] = useState<string | null>(null);
    const [cancelHotkeyError, setCancelHotkeyError] = useState<string | null>(null);
    /**
     * When non-null, the user has clicked "Use Fn" but the macOS
     * `AppleFnUsageType` setting is something other than 0 ("Do Nothing"),
     * so we surface a confirmation panel before mutating a global system
     * setting. `previous` captures the value to persist as the
     * restore-on-revert target.
     */
    const [pendingFnSetup, setPendingFnSetup] = useState<{ previous: number } | null>(null);

    const refreshDevices = useCallback(async () => {
        try {
            const list = await vox.listAudioInputDevices();
            setDevices(list);
        } catch {
            setDevices([]);
        }
    }, []);

    useEffect(() => {
        void (async () => {
            const [persistedDevice, persistedHotkey, persistedCancelHotkey] = await Promise.all([
                getSelectedMicDeviceId(),
                getHotkeyCombo(),
                getCancelHotkeyCombo(),
            ]);
            setSelectedDevice(persistedDevice ?? '');
            setHotkey(persistedHotkey);
            setCancelHotkey(persistedCancelHotkey);
            try {
                setAutostartEnabled(await autostart.isEnabled());
            } catch (e) {
                console.error('autostart.isEnabled failed', e);
            }
            await refreshDevices();
        })();
    }, [refreshDevices]);

    async function handleAutostartToggle(next: boolean) {
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

    async function handleDeviceChange(next: string) {
        setSelectedDevice(next);
        await setSelectedMicDeviceId(next === '' ? null : next);
    }

    async function handleHotkeyChange(combo: string) {
        const previousCombo = hotkey;
        setHotkey(combo);
        await setHotkeyCombo(combo);
        // If the user is moving AWAY from Fn back to a standard combo and we
        // previously stashed their original AppleFnUsageType, restore it now
        // so we don't leave the system setting in our state forever.
        if (previousCombo.trim().toLowerCase() === 'fn' && combo.trim().toLowerCase() !== 'fn') {
            try {
                const original = await getOriginalFnUsageType();
                if (original !== null) {
                    await vox.setFnUsageType(original);
                    await clearOriginalFnUsageType();
                }
            } catch (e) {
                console.error('restore AppleFnUsageType failed', e);
            }
        }
        try {
            await vox.registerHotkey(combo);
            setHotkeyError(null);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('register_hotkey failed', e);
            if (msg.includes(ERR_ACCESSIBILITY_REQUIRED)) {
                setHotkeyError(
                    'Fn key needs Accessibility permission. Click Open Settings, grant bluemacaw, then choose Use Fn again.',
                );
                try {
                    await vox.requestAccessibilityPermission();
                } catch {
                    // requestAccessibilityPermission already opens Settings; if it
                    // throws we keep the inline error visible.
                }
            } else {
                setHotkeyError(msg);
            }
        }
    }

    /**
     * User clicked "Use Fn". We need the macOS `AppleFnUsageType` setting to
     * be 0 ("Do Nothing") so the Fn key fires `FlagsChanged` events instead
     * of getting consumed by the system input-source switcher / emoji popup
     * / dictation. If it's already 0, register Fn directly; otherwise show a
     * confirmation panel and let the user decide.
     */
    async function handleUseFnRequested() {
        setHotkeyError(null);
        try {
            const current = await vox.getFnUsageType();
            if (current === null || current === 0) {
                await handleHotkeyChange('Fn');
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
            // Stash the original BEFORE writing 0, so a crash mid-flow
            // leaves us a record we can restore from on next launch.
            await setOriginalFnUsageType(pendingFnSetup.previous);
            await vox.setFnUsageType(0);
            setPendingFnSetup(null);
            await handleHotkeyChange('Fn');
        } catch (e) {
            setHotkeyError(e instanceof Error ? e.message : String(e));
        }
    }

    function handleCancelFnSetup() {
        setPendingFnSetup(null);
    }

    async function handleCaptureStart() {
        // Free the OS-level shortcut so the webview can see the keydown the
        // user is about to press. `handleHotkeyChange` will re-register it
        // when the new combo lands.
        try {
            await vox.unregisterHotkey();
        } catch (e) {
            console.error('unregister_hotkey failed', e);
        }
    }

    async function handleCaptureCancel() {
        // User aborted capture; restore whatever was registered before.
        try {
            await vox.registerHotkey(hotkey);
        } catch (e) {
            console.error('restore registerHotkey failed', e);
        }
    }

    async function handleCancelHotkeyChange(combo: string) {
        setCancelHotkey(combo);
        await setCancelHotkeyCombo(combo);
        try {
            // Validate without registering globally — the cancel hotkey
            // only goes live while a recording is in flight, so we don't
            // want to hold the binding here.
            await vox.validateCancelHotkey(combo);
            setCancelHotkeyError(null);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('validate_cancel_hotkey failed', e);
            setCancelHotkeyError(msg);
        }
    }

    function handleCancelHotkeyCaptureStart() {
        // No-op: the cancel hotkey is not persistently registered, so
        // there is nothing to release before the webview captures the
        // user's keydown. Kept as a stable prop hook for HotkeyInput.
    }

    function handleCancelHotkeyCaptureCancel() {
        // No-op: nothing to restore.
    }

    async function handleTestRecording() {
        setTestStatus('recording');
        setTestError(null);
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        try {
            const sessionId = await vox.startRecording(
                selectedDevice === '' ? undefined : selectedDevice,
            );
            await new Promise((r) => setTimeout(r, 3000));
            const bytes = await vox.stopRecording(sessionId);
            const blob = new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            setAudioUrl(url);
            setTestStatus('playing');
        } catch (e) {
            setTestError(e instanceof Error ? e.message : String(e));
            setTestStatus('error');
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Recording</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm font-medium normal-case">
                <div className="flex flex-col gap-1">
                    <Label htmlFor={hotkeyId}>Hotkey</Label>
                    <div id={hotkeyId}>
                        <HotkeyInput
                            value={hotkey}
                            onChange={handleHotkeyChange}
                            onCaptureStart={() => void handleCaptureStart()}
                            onCaptureCancel={() => void handleCaptureCancel()}
                            onUseFnRequested={() => void handleUseFnRequested()}
                        />
                    </div>
                    {hotkeyError && (
                        <p
                            data-testid="hotkey-error"
                            className="text-xs font-bold uppercase tracking-widest text-red-700"
                        >
                            {hotkeyError}
                        </p>
                    )}
                    {pendingFnSetup && (
                        <WarningBanner data-testid="fn-setup-confirm">
                            <p>
                                To use Fn, macOS needs <strong>Press 🌐 key to</strong> set to{' '}
                                <strong>Do Nothing</strong> (currently:{' '}
                                <strong>{fnUsageLabel(pendingFnSetup.previous)}</strong>). This is a
                                global system setting. bluemacaw will restore your original value
                                automatically when you switch away from Fn.
                            </p>
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={handleCancelFnSetup}>
                                    Cancel
                                </Button>
                                <Button onClick={() => void handleConfirmFnSetup()}>
                                    Set automatically
                                </Button>
                            </div>
                        </WarningBanner>
                    )}
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor={cancelHotkeyId}>Cancel hotkey</Label>
                    <p className="text-xs text-muted-foreground">
                        Only registered while a recording is in flight, so bare keys like Esc won't
                        intercept other apps when you're not recording.
                    </p>
                    <div id={cancelHotkeyId}>
                        <HotkeyInput
                            value={cancelHotkey}
                            onChange={(c) => void handleCancelHotkeyChange(c)}
                            onCaptureStart={handleCancelHotkeyCaptureStart}
                            onCaptureCancel={handleCancelHotkeyCaptureCancel}
                            allowFn={false}
                            allowBareKey={true}
                            allowChord={false}
                        />
                    </div>
                    {cancelHotkeyError && (
                        <p
                            data-testid="cancel-hotkey-error"
                            className="text-xs font-bold uppercase tracking-widest text-red-700"
                        >
                            {cancelHotkeyError}
                        </p>
                    )}
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor={deviceId}>Microphone</Label>
                    <div className="flex items-center gap-2">
                        <select
                            id={deviceId}
                            className="h-10 flex-1 rounded-xl border border-border bg-surface px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40 focus-visible:border-main"
                            value={selectedDevice}
                            onChange={(e) => void handleDeviceChange(e.target.value)}
                        >
                            <option value="">System default</option>
                            {devices.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.label}
                                </option>
                            ))}
                        </select>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => void refreshDevices()}
                        >
                            Refresh
                        </Button>
                    </div>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/30 p-3">
                    <div className="flex flex-col gap-0.5 pr-3">
                        <Label htmlFor={autostartId} className="cursor-pointer">
                            Start at login
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            Launch bluemacaw automatically into the tray when you sign in.
                        </p>
                    </div>
                    <Switch
                        id={autostartId}
                        data-testid="settings-autostart-toggle"
                        checked={autostartEnabled}
                        onCheckedChange={(v: boolean) => void handleAutostartToggle(v)}
                    />
                </div>
                {autostartError && (
                    <p
                        data-testid="settings-autostart-error"
                        className="text-xs font-bold uppercase tracking-widest text-red-700"
                    >
                        {autostartError}
                    </p>
                )}
                <div className="flex items-center justify-between">
                    <span data-testid="test-status" className="text-xs uppercase tracking-widest">
                        {testStatus === 'recording' && 'Recording 3s…'}
                        {testStatus === 'playing' && 'Captured. Press play.'}
                        {testStatus === 'error' && `Error: ${testError}`}
                    </span>
                    <Button
                        onClick={() => void handleTestRecording()}
                        disabled={testStatus === 'recording'}
                    >
                        Test recording
                    </Button>
                </div>
                {audioUrl && testStatus === 'playing' && (
                    /* biome-ignore lint/a11y/useMediaCaption: test playback only */
                    <audio src={audioUrl} controls className="w-full" />
                )}
            </CardContent>
        </Card>
    );
}
