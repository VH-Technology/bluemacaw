import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { type ApiKeyRow, addModelConfig, listApiKeys } from '@/lib/db';
import { vox } from '@/lib/invoke';
import { cn } from '@/lib/utils';
import { type Model, PROVIDERS } from '@/providers';
import { providerName } from '@/providers/util';
import { useEffect, useMemo, useState } from 'react';
import { ModelPicker } from './ModelPicker';

interface AddModelConfigDialogProps {
    open: boolean;
    onClose: () => void;
    onAdded: () => void;
}

export function AddModelConfigDialog({ open, onClose, onAdded }: AddModelConfigDialogProps) {
    const [keys, setKeys] = useState<ApiKeyRow[]>([]);
    const [selectedKey, setSelectedKey] = useState<string>('');
    const [models, setModels] = useState<Model[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const selectedProvider = useMemo(
        () => PROVIDERS.find((p) => p.id === keys.find((k) => k.id === selectedKey)?.providerId),
        [keys, selectedKey],
    );

    useEffect(() => {
        if (!open) return;
        void (async () => {
            const rows = await listApiKeys();
            setKeys(rows);
            setSelectedKey(rows[0]?.id ?? '');
        })();
    }, [open]);

    useEffect(() => {
        if (!selectedKey) {
            setModels([]);
            setSelectedModel('');
            return;
        }
        const apiKey = keys.find((k) => k.id === selectedKey);
        if (!apiKey) return;
        const provider = PROVIDERS.find((p) => p.id === apiKey.providerId);
        if (!provider) return;
        setModels(provider.defaultModels);
        setSelectedModel(provider.defaultModels[0]?.id ?? '');
        if (provider.listModels) {
            void (async () => {
                try {
                    const secret = await vox.getSecret(apiKey.id);
                    if (!secret) return;
                    const dynamic = await provider.listModels?.(secret);
                    if (dynamic && dynamic.length > 0) {
                        setModels(dynamic);
                        const first = dynamic[0];
                        setSelectedModel((current) =>
                            dynamic.some((m) => m.id === current) ? current : (first?.id ?? ''),
                        );
                    }
                } catch {
                    // fall back to defaultModels silently
                }
            })();
        }
    }, [selectedKey, keys]);

    function reset() {
        setSelectedKey('');
        setModels([]);
        setSelectedModel('');
        setError(null);
        setBusy(false);
    }

    async function handleSave() {
        setError(null);
        setBusy(true);
        try {
            if (!selectedKey || !selectedModel) {
                setError('Pick an API key and a model.');
                return;
            }
            await addModelConfig({ apiKeyId: selectedKey, modelId: selectedModel });
            reset();
            onAdded();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => {
                if (!o) {
                    reset();
                    onClose();
                }
            }}
        >
            <DialogContent data-testid="add-model-config-dialog">
                <DialogHeader>
                    <DialogTitle>Add Model Config</DialogTitle>
                    <DialogDescription>Pair an API key with a specific model.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3 text-sm font-medium normal-case">
                    {keys.length === 0 ? (
                        <p className="text-fg/60" data-testid="no-keys-message">
                            Add an API key first.
                        </p>
                    ) : (
                        <>
                            <div className="flex flex-col gap-2">
                                <Label>API key</Label>
                                <div
                                    className="grid gap-2 sm:grid-cols-2"
                                    data-testid="api-key-picker"
                                >
                                    {keys.map((k) => {
                                        const selected = k.id === selectedKey;
                                        return (
                                            <button
                                                key={k.id}
                                                type="button"
                                                aria-pressed={selected}
                                                onClick={() => setSelectedKey(k.id)}
                                                data-testid={`api-key-card-${k.id}`}
                                                className={cn(
                                                    'rounded-2xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40',
                                                    selected
                                                        ? 'border-main bg-main/10 shadow-card'
                                                        : 'border-border bg-surface hover:-translate-y-0.5 hover:border-main/40 hover:shadow-card',
                                                )}
                                            >
                                                <span className="block text-xs font-bold uppercase tracking-widest text-muted-foreground">
                                                    {providerName(k.providerId)}
                                                </span>
                                                <span className="block text-sm font-extrabold">
                                                    {k.nickname}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label>Model</Label>
                                <ModelPicker
                                    models={models}
                                    selectedModelId={selectedModel}
                                    onSelect={setSelectedModel}
                                    providerId={selectedProvider?.id}
                                />
                            </div>
                        </>
                    )}
                    {error && (
                        <p className="text-xs font-bold text-red-700" role="alert">
                            {error}
                        </p>
                    )}
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => {
                            reset();
                            onClose();
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={busy || keys.length === 0}
                        data-testid="save-model-config"
                    >
                        {busy ? 'Saving…' : 'Save'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
