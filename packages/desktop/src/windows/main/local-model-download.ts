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

export interface LocalModelDownloadRequest {
    modelId: string;
    displayName: string;
    url?: string;
}

let pendingRequest: LocalModelDownloadRequest | null = null;

export function setPendingLocalDownloadRequest(request: LocalModelDownloadRequest): void {
    pendingRequest = request;
}

export function consumePendingLocalDownloadRequest(): LocalModelDownloadRequest | null {
    const current = pendingRequest;
    pendingRequest = null;
    return current;
}
