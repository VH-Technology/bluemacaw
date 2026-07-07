export interface LocalModelDownloadProgress {
    received: number;
    total: number;
}

export type LocalModelDownloadStatus = 'downloading' | 'complete' | 'error';

export interface LocalModelDownloadSheetState {
    modelId: string;
    displayName: string;
    status: LocalModelDownloadStatus;
    progress: LocalModelDownloadProgress | null;
    error?: string;
}
