import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { type ApiKeyRow, listApiKeys } from '@/lib/db';
import { PROVIDERS } from '@/providers';
import { useCallback, useEffect, useState } from 'react';
import { AddApiKeyDialog } from './AddApiKeyDialog';
import { DeleteApiKeyDialog } from './DeleteApiKeyDialog';
import { ProviderLogo } from './ProviderPicker';

export function SettingsApiKeys() {
    const [keys, setKeys] = useState<ApiKeyRow[]>([]);
    const [adding, setAdding] = useState(false);
    const [deleting, setDeleting] = useState<ApiKeyRow | null>(null);

    const reload = useCallback(async () => {
        setKeys(await listApiKeys());
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>API Keys</CardTitle>
                <Button size="sm" onClick={() => setAdding(true)} data-testid="add-api-key">
                    Add API Key
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm font-medium normal-case">
                {keys.length === 0 ? (
                    <p className="text-fg/60" data-testid="api-keys-empty">
                        No API keys yet. Add one to get started.
                    </p>
                ) : (
                    keys.map((k) => {
                        const provider = PROVIDERS.find((p) => p.id === k.providerId);
                        const providerDisplayName = provider?.name ?? k.providerId;
                        return (
                            <div
                                key={k.id}
                                data-testid={`api-key-row-${k.id}`}
                                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3"
                            >
                                <div className="flex min-w-0 items-center gap-3">
                                    {provider ? (
                                        <ProviderLogo
                                            provider={provider}
                                            className="h-9 w-9 p-1.5"
                                        />
                                    ) : null}
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-extrabold leading-tight">
                                            {providerDisplayName}
                                        </div>
                                        <div className="truncate text-xs font-medium text-muted-foreground">
                                            {k.nickname}
                                        </div>
                                    </div>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="shrink-0 border-red-500/30 text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                                    onClick={() => setDeleting(k)}
                                    data-testid={`delete-api-key-${k.id}`}
                                >
                                    Delete
                                </Button>
                            </div>
                        );
                    })
                )}
            </CardContent>
            <AddApiKeyDialog
                open={adding}
                onClose={() => setAdding(false)}
                onAdded={() => {
                    setAdding(false);
                    void reload();
                }}
            />
            {deleting && (
                <DeleteApiKeyDialog
                    apiKey={deleting}
                    onClose={() => setDeleting(null)}
                    onDeleted={() => {
                        setDeleting(null);
                        void reload();
                    }}
                />
            )}
        </Card>
    );
}
