import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { WarningBanner } from '@/components/ui/warning-banner';
import {
    type ApiKeyRow,
    type ModelConfigWithApiKey,
    deleteApiKey,
    getActiveModelConfigId,
    listModelConfigDependencies,
} from '@/lib/db';
import { providerName } from '@/providers/util';
import { useEffect, useState } from 'react';

interface DeleteApiKeyDialogProps {
    apiKey: ApiKeyRow;
    onClose: () => void;
    onDeleted: () => void;
}

export function DeleteApiKeyDialog({ apiKey, onClose, onDeleted }: DeleteApiKeyDialogProps) {
    const [dependents, setDependents] = useState<ModelConfigWithApiKey[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        void (async () => {
            const [deps, active] = await Promise.all([
                listModelConfigDependencies(apiKey.id),
                getActiveModelConfigId(),
            ]);
            setDependents(deps);
            setActiveId(active);
        })();
    }, [apiKey.id]);

    const activeWillBeDeleted = activeId !== null && dependents.some((d) => d.id === activeId);

    async function handleDelete() {
        setError(null);
        setBusy(true);
        try {
            await deleteApiKey(apiKey.id);
            onDeleted();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent data-testid="delete-api-key-dialog">
                <DialogHeader>
                    <DialogTitle>Delete API Key</DialogTitle>
                    <DialogDescription>
                        Cascades to any model configs that use this key.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3 text-sm font-medium normal-case">
                    <p>
                        Delete <span className="font-bold">{apiKey.nickname}</span> (
                        {providerName(apiKey.providerId)})?
                    </p>
                    {dependents.length > 0 && (
                        <div className="flex flex-col gap-1">
                            <p className="text-xs font-bold uppercase tracking-widest">
                                Will also delete these model configs:
                            </p>
                            <ul className="list-disc pl-5 text-xs" data-testid="dependent-list">
                                {dependents.map((d) => (
                                    <li key={d.id}>
                                        {providerName(d.providerId)} · {d.modelId}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {activeWillBeDeleted && (
                        <WarningBanner data-testid="active-warning" className="text-xs font-bold">
                            One of these is your active selection. After deletion no model will be
                            selected for transcription.
                        </WarningBanner>
                    )}
                    {error && (
                        <p className="text-xs font-bold text-red-700" role="alert">
                            {error}
                        </p>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={handleDelete}
                        disabled={busy}
                        data-testid="confirm-delete"
                    >
                        {busy ? 'Deleting…' : 'Delete'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
