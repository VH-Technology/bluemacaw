import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addApiKey } from '@/lib/db';
import { PROVIDERS, type ProviderConfig } from '@/providers';
import { useId, useState } from 'react';
import { ProviderPicker } from './ProviderPicker';

interface AddApiKeyDialogProps {
    open: boolean;
    onClose: () => void;
    onAdded: () => void;
}

async function validateAgainstProvider(
    provider: ProviderConfig,
    key: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (provider.validateKey) {
        try {
            const ok = await provider.validateKey(key);
            return ok ? { ok: true } : { ok: false, reason: 'Provider rejected this key.' };
        } catch (e) {
            return { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
    }
    if (provider.listModels) {
        try {
            await provider.listModels(key);
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: e instanceof Error ? e.message : String(e) };
        }
    }
    return { ok: true };
}

export function AddApiKeyDialog({ open, onClose, onAdded }: AddApiKeyDialogProps) {
    const nicknameId = useId();
    const keyId = useId();
    const defaultProvider = PROVIDERS[0]?.id ?? '';
    const [provider, setProvider] = useState(defaultProvider);
    const [nickname, setNickname] = useState('');
    const [key, setKey] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    function reset() {
        setProvider(defaultProvider);
        setNickname('');
        setKey('');
        setError(null);
        setBusy(false);
    }

    async function handleSave() {
        setError(null);
        setBusy(true);
        try {
            const config = PROVIDERS.find((p) => p.id === provider);
            if (!config) throw new Error(`Unknown provider: ${provider}`);
            const trimmedNickname = nickname.trim();
            const trimmedKey = key.trim();
            if (!trimmedNickname) {
                setError('Nickname is required.');
                return;
            }
            if (!trimmedKey) {
                setError('API key is required.');
                return;
            }
            const validation = await validateAgainstProvider(config, trimmedKey);
            if (!validation.ok) {
                setError(`Validation failed: ${validation.reason}`);
                return;
            }
            await addApiKey({
                providerId: provider,
                nickname: trimmedNickname,
                secret: trimmedKey,
            });
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
            <DialogContent className="max-w-5xl" data-testid="add-api-key-dialog">
                <DialogHeader>
                    <DialogTitle>Add API Key</DialogTitle>
                    <DialogDescription>
                        Validates against the provider before saving.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3 text-sm font-medium normal-case">
                    <div className="flex flex-col gap-2">
                        <Label>Provider</Label>
                        <ProviderPicker
                            providers={PROVIDERS}
                            selectedProviderId={provider}
                            onSelect={setProvider}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label htmlFor={nicknameId}>Nickname</Label>
                        <Input
                            id={nicknameId}
                            data-testid="nickname-input"
                            value={nickname}
                            onChange={(e) => setNickname(e.target.value)}
                            placeholder="Personal, Work, …"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label htmlFor={keyId}>API key</Label>
                        <Input
                            id={keyId}
                            data-testid="key-input"
                            type="password"
                            value={key}
                            onChange={(e) => setKey(e.target.value)}
                        />
                    </div>
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
                        disabled={busy}
                        data-action="save"
                        data-testid="save-api-key"
                    >
                        {busy ? 'Saving…' : 'Save'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
