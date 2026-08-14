import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { LocalModelDownloadSheetState } from './local-model-download';

interface LocalModelDownloadSheetProps {
    download: LocalModelDownloadSheetState;
    onClose: () => void;
    onCancel: () => void;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function LocalModelDownloadSheet({
    download,
    onClose,
    onCancel,
}: LocalModelDownloadSheetProps) {
    const isDownloading = download.status === 'downloading';
    const isComplete = download.status === 'complete';
    const progressPct =
        download.progress && download.progress.total > 0
            ? Math.round((download.progress.received / download.progress.total) * 100)
            : isComplete
              ? 100
              : 0;

    return (
        <Card className="fixed bottom-6 right-6 z-50 w-[22rem] border border-border/70 bg-surface p-4 shadow-card-lg">
            <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                        <span className="text-sm font-bold">
                            {download.status === 'error'
                                ? 'Download failed'
                                : isComplete
                                  ? 'Download complete'
                                  : 'Model is downloading'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {download.status === 'error'
                                ? 'Check your connection or try again.'
                                : isComplete
                                  ? 'Model is ready and selected.'
                                  : 'The model will be automatically selected for use once the download is finished.'}
                        </span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={isDownloading ? onCancel : onClose}>
                        {isDownloading ? 'Cancel' : 'Close'}
                    </Button>
                </div>
                {download.status === 'error' ? (
                    <p className="text-xs text-red-600" role="alert">
                        {download.error ?? 'Download failed.'}
                    </p>
                ) : (
                    <>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                                className="h-full bg-brand-blue transition-all"
                                style={{ width: `${progressPct}%` }}
                            />
                        </div>
                        {download.progress && (
                            <span className="text-xs text-muted-foreground">
                                {download.progress.total > 0
                                    ? `${progressPct}% • ${formatSize(download.progress.received)} / ${formatSize(
                                          download.progress.total,
                                      )}`
                                    : `${formatSize(download.progress.received)} downloaded`}
                            </span>
                        )}
                    </>
                )}
            </div>
        </Card>
    );
}
