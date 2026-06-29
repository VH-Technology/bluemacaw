import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    type ModelConfigWithApiKey,
    deleteModelConfig,
    getActiveModelConfigId,
    listModelConfigs,
    setActiveModelConfigId,
} from '@/lib/db';
import { cn } from '@/lib/utils';
import { PROVIDERS } from '@/providers';
import { modelPriceLabel, providerName } from '@/providers/util';
import { useCallback, useEffect, useState } from 'react';
import { AddModelConfigDialog } from './AddModelConfigDialog';
import { ModelModeBadge } from './ModelPicker';
import { ProviderLogo } from './ProviderPicker';

export function SettingsModelConfigs() {
    const [configs, setConfigs] = useState<ModelConfigWithApiKey[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);

    const reload = useCallback(async () => {
        const [list, active] = await Promise.all([listModelConfigs(), getActiveModelConfigId()]);
        setConfigs(list);
        setActiveId(active);
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    async function handleSelect(id: string) {
        await setActiveModelConfigId(id);
        setActiveId(id);
    }

    async function handleDelete(id: string) {
        await deleteModelConfig(id);
        void reload();
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Models</CardTitle>
                <Button size="sm" onClick={() => setAdding(true)} data-testid="add-model-config">
                    Add Model Config
                </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm font-medium normal-case">
                {configs.length === 0 ? (
                    <p className="text-fg/60" data-testid="model-configs-empty">
                        No model configs yet. Add one and click it to make it active.
                    </p>
                ) : (
                    configs.map((c) => {
                        const active = c.id === activeId;
                        const provider = PROVIDERS.find((p) => p.id === c.providerId);
                        const model = provider?.defaultModels.find((m) => m.id === c.modelId);
                        const price = modelPriceLabel(c.providerId, c.modelId);
                        return (
                            <div
                                key={c.id}
                                data-testid={`model-config-row-${c.id}`}
                                data-active={active ? 'true' : 'false'}
                                className={cn(
                                    'flex items-center gap-3 rounded-xl border p-3 transition-colors',
                                    active
                                        ? 'border-main bg-main/10 text-fg'
                                        : 'border-border bg-muted/40 hover:bg-muted',
                                )}
                            >
                                <button
                                    type="button"
                                    onClick={() => void handleSelect(c.id)}
                                    className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40"
                                    data-testid={`select-model-config-${c.id}`}
                                >
                                    {provider ? (
                                        <ProviderLogo
                                            provider={provider}
                                            selected={active}
                                            className="h-9 w-9 p-1.5"
                                        />
                                    ) : null}
                                    <span className="min-w-0">
                                        <span className="flex flex-wrap items-center gap-2 text-sm font-extrabold leading-tight">
                                            <span>{model?.displayName ?? c.modelId}</span>
                                            {model && <ModelModeBadge mode={model.mode} />}
                                            {price && (
                                                <span className="rounded-pill bg-muted px-2 py-0.5 text-[11px] font-extrabold text-fg/70">
                                                    {price}
                                                </span>
                                            )}
                                        </span>
                                        <span className="mt-1 block truncate text-xs font-medium text-muted-foreground">
                                            {providerName(c.providerId)} · {c.apiKeyNickname}
                                        </span>
                                    </span>
                                </button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="shrink-0 border-red-500/30 text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                                    onClick={() => void handleDelete(c.id)}
                                    data-testid={`delete-model-config-${c.id}`}
                                >
                                    Delete
                                </Button>
                            </div>
                        );
                    })
                )}
            </CardContent>
            <AddModelConfigDialog
                open={adding}
                onClose={() => setAdding(false)}
                onAdded={() => {
                    setAdding(false);
                    void reload();
                }}
            />
        </Card>
    );
}
