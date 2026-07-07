import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { getActiveLocalModelId, setActiveLocalModelId } from '@/lib/db';
import { vox } from '@/lib/invoke';
import { cn } from '@/lib/utils';
import { DEFAULT_LOCAL_MODELS } from '@/providers/local';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';

interface LocalModelInfo {
    modelId: string;
    fileSizeBytes: number;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface SettingsLocalModelsProps {
    refreshToken?: number;
    onActiveChange?: () => void;
}

interface DownloadProgressPayload {
    modelId: string;
    received: number;
    total: number;
}

interface DownloadCompletePayload {
    modelId: string;
    localPath: string;
}

export function SettingsLocalModels({ refreshToken, onActiveChange }: SettingsLocalModelsProps) {
    const [models, setModels] = useState<LocalModelInfo[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [showDownloadPicker, setShowDownloadPicker] = useState(false);
    const [selectedSize, setSelectedSize] = useState('ggml-medium.en');
    const [customUrl, setCustomUrl] = useState('');
    const [downloading, setDownloading] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<{
        received: number;
        total: number;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const list = await vox.listLocalModels();
            setModels(list);
            const active = await getActiveLocalModelId();
            setActiveId(active);
        } catch (e) {
            console.error('listLocalModels failed', e);
        }
    }, []);

    useEffect(() => {
        let mounted = true;
        const unlistenFns: Array<() => void> = [];

        const onProgress = listen<DownloadProgressPayload>('download://progress', (event) => {
            const { modelId, received, total } = event.payload;
            if (!mounted) return;
            if (downloading && modelId !== downloading) return;
            setDownloadProgress({ received, total });
        });

        const onComplete = listen<DownloadCompletePayload>('download://complete', (event) => {
            const { modelId } = event.payload;
            if (!mounted) return;
            if (downloading && modelId !== downloading) return;
            setDownloadProgress(null);
        });

        const onError = listen<{ modelId: string; error: string }>('download://error', (event) => {
            const { modelId, error: message } = event.payload;
            if (!mounted) return;
            if (downloading && modelId !== downloading) return;
            setError(message);
            setDownloadProgress(null);
        });

        void Promise.all([onProgress, onComplete, onError]).then((handlers) => {
            if (!mounted) {
                for (const unlisten of handlers) {
                    unlisten();
                }
                return;
            }
            unlistenFns.push(...handlers);
        });

        return () => {
            mounted = false;
            for (const unlisten of unlistenFns) {
                unlisten();
            }
        };
    }, [downloading]);

    useEffect(() => {
        void refreshToken;
        void load();
    }, [load, refreshToken]);

    async function handleDownload() {
        setError(null);
        setDownloading(selectedSize);
        setDownloadProgress(null);
        try {
            const url = customUrl.trim() || undefined;
            await vox.downloadWhisperModel(selectedSize, url);
            setDownloading(null);
            setShowDownloadPicker(false);
            await setActiveLocalModelId(selectedSize);
            setActiveId(selectedSize);
            onActiveChange?.();
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setDownloading(null);
        }
    }

    async function handleActivate(modelId: string) {
        await setActiveLocalModelId(modelId);
        setActiveId(modelId);
        onActiveChange?.();
    }

    async function handleDelete(modelId: string) {
        await vox.deleteLocalModel(modelId);
        if (activeId === modelId) {
            await setActiveLocalModelId(null);
            setActiveId(null);
        }
        setDeleteConfirm(null);
        await load();
    }

    async function handleCancelDownload() {
        if (downloading) {
            await vox.cancelModelDownload(downloading);
            setDownloading(null);
            setDownloadProgress(null);
        }
    }

    return (
        <div
            className="flex flex-col gap-3 text-sm font-medium normal-case"
            data-testid="settings-local-models"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <h3 className="text-xs font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                        Local
                    </h3>
                </div>
                <Button
                    size="sm"
                    data-testid="local-models-download-btn"
                    onClick={() => setShowDownloadPicker(true)}
                    disabled={showDownloadPicker}
                >
                    Add local model
                </Button>
            </div>

            {models.length > 0 && (
                <div className="flex flex-col gap-2">
                    {models.map((m) => {
                        const meta = DEFAULT_LOCAL_MODELS.find((entry) => entry.id === m.modelId);
                        const displayName = meta?.displayName ?? m.modelId;
                        return (
                            <div
                                key={m.modelId}
                                data-testid={`local-model-${m.modelId}`}
                                className={cn(
                                    'flex items-center justify-between rounded-xl border p-3 transition-colors',
                                    activeId === m.modelId
                                        ? 'border-main bg-main/10 text-fg'
                                        : 'border-border bg-muted/40 hover:bg-muted',
                                )}
                            >
                                <button
                                    type="button"
                                    onClick={() => void handleActivate(m.modelId)}
                                    className="flex min-w-0 flex-1 flex-col gap-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40"
                                    data-testid={`select-local-model-${m.modelId}`}
                                >
                                    <span className="flex flex-wrap items-center gap-2 text-sm font-bold">
                                        <span>{displayName}</span>
                                    </span>
                                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        {displayName !== m.modelId && (
                                            <span className="font-mono text-[11px] text-muted-foreground">
                                                {m.modelId}
                                            </span>
                                        )}
                                        <span>{formatSize(m.fileSizeBytes)}</span>
                                    </span>
                                </button>
                                <div className="flex items-center gap-2">
                                    {deleteConfirm === m.modelId ? (
                                        <div className="flex items-center gap-1">
                                            <Button
                                                size="sm"
                                                variant="destructive"
                                                onClick={() => void handleDelete(m.modelId)}
                                            >
                                                Confirm
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => setDeleteConfirm(null)}
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="shrink-0 border-red-500/30 text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                                            onClick={() => setDeleteConfirm(m.modelId)}
                                        >
                                            Delete
                                        </Button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {downloading && (
                <Card className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                        <span className="text-sm font-bold">Downloading {downloading}…</span>
                        {downloadProgress && downloadProgress.total > 0 && (
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full bg-brand-blue transition-all"
                                    style={{
                                        width: `${Math.round((downloadProgress.received / downloadProgress.total) * 100)}%`,
                                    }}
                                />
                            </div>
                        )}
                        {downloadProgress && (
                            <span className="text-xs text-muted-foreground">
                                {downloadProgress.total > 0
                                    ? `${Math.round((downloadProgress.received / downloadProgress.total) * 100)}% • ${formatSize(
                                          downloadProgress.received,
                                      )} / ${formatSize(downloadProgress.total)}`
                                    : `${formatSize(downloadProgress.received)} downloaded`}
                            </span>
                        )}
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleCancelDownload()}
                        >
                            Cancel
                        </Button>
                    </div>
                </Card>
            )}

            {error && (
                <p className="text-sm text-red-600" role="alert">
                    {error}
                </p>
            )}

            {showDownloadPicker ? (
                <Card className="flex flex-col gap-4 p-4">
                    <h4 className="text-sm font-bold">Download a model</h4>
                    <div className="flex flex-col gap-2">
                        {DEFAULT_LOCAL_MODELS.map((m) => (
                            <label
                                key={m.id}
                                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${
                                    selectedSize === m.id
                                        ? 'border-brand-blue bg-brand-blue/5'
                                        : 'border-border'
                                }`}
                            >
                                <input
                                    type="radio"
                                    name="model-size"
                                    value={m.id}
                                    checked={selectedSize === m.id}
                                    onChange={() => setSelectedSize(m.id)}
                                />
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-sm font-bold">{m.displayName}</span>
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {m.id}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {m.description}
                                    </span>
                                </div>
                            </label>
                        ))}
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label>Custom URL (optional)</Label>
                        <input
                            type="text"
                            value={customUrl}
                            onChange={(e) => setCustomUrl(e.target.value)}
                            placeholder="https://huggingface.co/.../ggml-custom.bin"
                            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={() => void handleDownload()}>Download</Button>
                        <Button variant="ghost" onClick={() => setShowDownloadPicker(false)}>
                            Cancel
                        </Button>
                    </div>
                </Card>
            ) : null}
        </div>
    );
}
