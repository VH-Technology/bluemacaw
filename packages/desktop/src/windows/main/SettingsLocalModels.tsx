import { Button } from '@/components/ui/button';
import { getActiveLocalModelId, setActiveLocalModelId } from '@/lib/db';
import { vox } from '@/lib/invoke';
import { cn } from '@/lib/utils';
import { DEFAULT_LOCAL_MODELS } from '@/providers/local';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AddLocalModelDialog } from './AddLocalModelDialog';
import type { LocalModelDownloadSheetState } from './local-model-download';

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
    downloadSheet?: LocalModelDownloadSheetState | null;
    onStartDownload?: (modelId: string, url?: string, displayName?: string) => void;
}

export function SettingsLocalModels({
    refreshToken,
    onActiveChange,
    downloadSheet,
    onStartDownload,
}: SettingsLocalModelsProps) {
    const [models, setModels] = useState<LocalModelInfo[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [addDialogOpen, setAddDialogOpen] = useState(false);
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
        void refreshToken;
        void load();
    }, [load, refreshToken]);

    useEffect(() => {
        if (downloadSheet?.status !== 'complete') return;
        void load();
        onActiveChange?.();
    }, [downloadSheet?.status, load, onActiveChange]);

    function handleDownload(modelId: string, url?: string, displayName?: string) {
        onStartDownload?.(modelId, url, displayName);
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

    const displayModels = useMemo(() => {
        if (!downloadSheet || downloadSheet.status !== 'downloading') return models;
        if (models.some((entry) => entry.modelId === downloadSheet.modelId)) return models;
        const received = downloadSheet.progress?.received ?? 0;
        return [...models, { modelId: downloadSheet.modelId, fileSizeBytes: received }];
    }, [models, downloadSheet]);

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
                    onClick={() => setAddDialogOpen(true)}
                    disabled={downloadSheet?.status === 'downloading'}
                >
                    Add local model
                </Button>
            </div>

            {displayModels.length > 0 && (
                <div className="max-h-72 overflow-y-auto pr-1">
                    <div className="flex flex-col gap-2">
                        {displayModels.map((m) => {
                            const meta = DEFAULT_LOCAL_MODELS.find(
                                (entry) => entry.id === m.modelId,
                            );
                            const displayName = meta?.displayName ?? m.modelId;
                            const isDownloading =
                                downloadSheet?.status === 'downloading' &&
                                downloadSheet.modelId === m.modelId;
                            const progress = isDownloading ? downloadSheet?.progress : null;
                            const progressPct =
                                progress && progress.total > 0
                                    ? Math.round((progress.received / progress.total) * 100)
                                    : null;
                            const sizeLabel =
                                isDownloading && progress
                                    ? formatSize(progress.received)
                                    : formatSize(m.fileSizeBytes);
                            return (
                                <div
                                    key={m.modelId}
                                    data-testid={`local-model-${m.modelId}`}
                                    className={cn(
                                        'flex items-center justify-between rounded-xl border p-3 transition-colors',
                                        activeId === m.modelId
                                            ? 'border-main bg-main/10 text-fg'
                                            : 'border-border bg-muted/40 hover:bg-muted',
                                        isDownloading && 'opacity-70',
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => void handleActivate(m.modelId)}
                                        disabled={isDownloading}
                                        className={cn(
                                            'flex min-w-0 flex-1 flex-col gap-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main/40',
                                            isDownloading && 'cursor-not-allowed',
                                        )}
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
                                            <span>{sizeLabel}</span>
                                            {isDownloading && (
                                                <span>
                                                    {progressPct !== null
                                                        ? `Downloading ${progressPct}%`
                                                        : 'Downloading…'}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                    <div className="flex items-center gap-2">
                                        {deleteConfirm === m.modelId ? (
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    onClick={() => void handleDelete(m.modelId)}
                                                    disabled={isDownloading}
                                                >
                                                    Confirm
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => setDeleteConfirm(null)}
                                                    disabled={isDownloading}
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
                                                disabled={isDownloading}
                                            >
                                                Delete
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <AddLocalModelDialog
                open={addDialogOpen}
                onClose={() => setAddDialogOpen(false)}
                onDownload={(modelId, url, displayName) =>
                    handleDownload(modelId, url, displayName)
                }
            />
        </div>
    );
}
