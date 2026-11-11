import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Toast } from '@/components/ui/toast';
import { getOverlayEnabled, setOverlayEnabled } from '@/lib/db';
import {
    OVERLAY_POSITION_SETUP_OFF_EVENT,
    type SetupExitPayload,
    enterOverlayPositionSetup,
    exitOverlayPositionSetup,
    hideOverlayWindow,
    resetOverlayPosition,
} from '@/lib/overlay-bridge';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useId, useState } from 'react';
import { SettingsOverlaySensitivity } from './SettingsOverlaySensitivity';

export function SettingsOverlay() {
    const enableId = useId();
    const [enabled, setEnabled] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [positioning, setPositioning] = useState(false);
    const [toastMessage, setToastMessage] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const value = await getOverlayEnabled();
            if (cancelled) return;
            setEnabled(value);
            setLoaded(true);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const unlistenP = listen<SetupExitPayload>(OVERLAY_POSITION_SETUP_OFF_EVENT, (event) => {
            if (cancelled) return;
            setPositioning(false);
            const reason = event.payload?.reason;
            if (reason === 'manual' || reason === 'idle') {
                setToastMessage('Overlay position saved');
            }
        });
        return () => {
            cancelled = true;
            void unlistenP.then((fn) => fn());
        };
    }, []);

    async function handleEnableChange(next: boolean) {
        setEnabled(next);
        await setOverlayEnabled(next);
        if (!next) await hideOverlayWindow();
    }

    async function handleTogglePositioning() {
        if (positioning) {
            setPositioning(false);
            // The listener above will pick up the 'manual' reason and show the
            // toast — keep this branch silent so we don't double-toast.
            await exitOverlayPositionSetup({ hide: true, reason: 'manual' });
        } else {
            setPositioning(true);
            await enterOverlayPositionSetup();
        }
    }

    async function handleResetPosition() {
        await resetOverlayPosition();
        setToastMessage('Overlay position reset');
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Overlay</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm font-medium normal-case">
                <div className="flex items-center justify-between">
                    <Label htmlFor={enableId}>Enable overlay</Label>
                    <Switch
                        id={enableId}
                        checked={enabled}
                        disabled={!loaded}
                        onCheckedChange={(v) => void handleEnableChange(v)}
                    />
                </div>
                <SettingsOverlaySensitivity />
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleResetPosition()}
                        data-testid="reset-overlay-position"
                    >
                        Reset position
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => void handleTogglePositioning()}
                        data-testid="toggle-overlay-positioning"
                    >
                        {positioning ? 'Use this position' : 'Position overlay'}
                    </Button>
                </div>
            </CardContent>
            <Toast
                open={toastMessage !== null}
                message={toastMessage ?? ''}
                onClose={() => setToastMessage(null)}
                testId="overlay-toast"
            />
        </Card>
    );
}
