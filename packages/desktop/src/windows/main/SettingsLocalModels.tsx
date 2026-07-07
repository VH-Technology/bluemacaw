import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { getActiveLocalModelId, setActiveLocalModelId } from '@/lib/db';
import { vox } from '@/lib/invoke';
import { cn } from '@/lib/utils';
import { DEFAULT_LOCAL_MODELS } from '@/providers/local';
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

export function SettingsLocalModels() {
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
        void load();
    }, [load]);

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
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setDownloading(null);
        }
    }

    async function handleActivate(modelId: string) {
        await setActiveLocalModelId(modelId);
        setActiveId(modelId);
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
        <Card data-testid="settings-local-models">
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Local models (on-device)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm font-medium normal-case">
                <p className="text-sm text-muted-foreground">
                    Run transcription directly on your device — no internet needed, no API key
                    required. The curated set below covers popular sizes from{' '}
                    <a
                        href="https://huggingface.co/ggerganov/whisper.cpp"
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-main hover:underline"
                    >
                        ggerganov/whisper.cpp
                    </a>
                    , but you can download any Whisper GGML model by pasting its URL below.
                </p>

                {models.length > 0 && (
                    <div className="flex flex-col gap-2">
                        {models.map((m) => (
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
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-sm font-bold">{m.modelId}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {formatSize(m.fileSizeBytes)}
                                        {activeId === m.modelId && (
                                            <span className="ml-2 rounded-pill bg-main px-2 py-0.5 text-[11px] font-extrabold text-main-foreground">
                                                In use
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {activeId !== m.modelId && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => void handleActivate(m.modelId)}
                                        >
                                            Use
                                        </Button>
                                    )}
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
                                            variant="ghost"
                                            onClick={() => setDeleteConfirm(m.modelId)}
                                        >
                                            Delete
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
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
                        <h3 className="text-sm font-bold">Download a model</h3>
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
                ) : (
                    <Button
                        variant="outline"
                        data-testid="local-models-download-btn"
                        onClick={() => setShowDownloadPicker(true)}
                    >
                        Download a model
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}
