import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { UpdaterStatus } from '@/hooks/useUpdater';
import { useId, useState } from 'react';

export interface SettingsUpdatesProps {
    /** Current updater status (defaults to idle when nothing is wired). */
    status?: UpdaterStatus;
    onCheckNow?: () => void;
    /** Start the download + restart. Triggered after the user confirms. */
    onInstall?: () => void;
    onToggleAutoUpdate?: (enabled: boolean) => void;
}

function statusLine(status: UpdaterStatus): string {
    switch (status.kind) {
        case 'idle':
            return 'Click "Check now" to look for updates.';
        case 'checking':
            return 'Checking for updates…';
        case 'up-to-date':
            return 'You’re on the latest version.';
        case 'available':
            return `Update ${status.version} is ready to install.`;
        case 'downloading':
            return `Downloading update… ${Math.round(status.progress * 100)}%`;
        case 'installing':
            return 'Installing update… the app will restart.';
        case 'error':
            return `Last check failed: ${status.message}`;
    }
}

export function SettingsUpdates({
    status = { kind: 'idle' },
    onCheckNow,
    onInstall,
    onToggleAutoUpdate,
}: SettingsUpdatesProps = {}) {
    const autoId = useId();
    const [auto, setAuto] = useState(true);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const checking = status.kind === 'checking';
    const available = status.kind === 'available';
    // Mid-update: download/install is in flight, so neither check nor a fresh
    // install should be offered.
    const busy = status.kind === 'downloading' || status.kind === 'installing';
    const version = status.kind === 'available' ? status.version : undefined;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Updates</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm font-medium normal-case">
                <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-muted/30 p-3">
                    <div className="flex flex-col gap-0.5 pr-3">
                        <Label htmlFor={autoId} className="cursor-pointer">
                            Auto-update
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            Install future updates automatically when available.
                        </p>
                    </div>
                    <Switch
                        id={autoId}
                        checked={auto}
                        onCheckedChange={(value) => {
                            setAuto(value);
                            onToggleAutoUpdate?.(value);
                        }}
                    />
                </div>
                <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-0.5">
                        <Label>Status</Label>
                        <p
                            className="text-xs text-muted-foreground"
                            data-testid="updates-status-line"
                        >
                            {statusLine(status)}
                        </p>
                    </div>
                    {available ? (
                        // An update was found — swap "Check now" for the install
                        // action. Clicking it asks for confirmation first.
                        <Button className="sm:ml-auto" onClick={() => setConfirmOpen(true)}>
                            Install &amp; restart
                        </Button>
                    ) : (
                        <Button
                            variant="outline"
                            className="sm:ml-auto"
                            onClick={() => onCheckNow?.()}
                            disabled={checking || busy}
                        >
                            {checking ? 'Checking…' : busy ? 'Updating…' : 'Check now'}
                        </Button>
                    )}
                </div>
            </CardContent>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent data-testid="update-confirm">
                    <DialogHeader>
                        <DialogTitle>Install update{version ? ` ${version}` : ''}?</DialogTitle>
                        <DialogDescription>
                            bluemacaw will download the update and restart to apply it. Any
                            in-progress recording will be lost.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={() => {
                                setConfirmOpen(false);
                                onInstall?.();
                            }}
                        >
                            Install &amp; restart
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
