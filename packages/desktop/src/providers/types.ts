import type { TranscriptionModel } from 'ai';

export type TranscriptionMode = 'batch' | 'realtime';

export interface Model {
    id: string;
    displayName: string;
    description?: string;
    mode: TranscriptionMode;
}

export interface PricingEntry {
    perMinuteUSD: number;
    lastUpdated: string;
}

/**
 * A realtime transcription session. Audio is streamed in as PCM chunks
 * while the recording is active; `finish()` resolves with the final
 * transcript once the provider has emitted its end-of-stream signal.
 *
 * Implementations are responsible for any provider-specific handshake,
 * authentication, and protocol details (WebSocket framing, control
 * messages, etc.). Callers only see this minimal lifecycle.
 */
export interface RealtimeSession {
    sendAudio(pcm: Int16Array): void;
    finish(): Promise<string>;
    abort(): void;
}

export interface RealtimeModel {
    connect(opts: { sampleRate: number }): Promise<RealtimeSession>;
}

export interface ProviderConfig {
    id: string;
    name: string;
    logoSrc: string;
    docsUrl: string;
    apiKeyHelpUrl: string;
    pricingDocsUrl: string;
    makeModel: (modelId: string, apiKey: string) => TranscriptionModel;
    /**
     * Escape hatch for providers the Vercel AI SDK has no transcription
     * adapter for (e.g. xAI Grok's `/v1/stt` endpoint). When set, the batch
     * `transcribe()` path calls this directly instead of
     * `experimental_transcribe`, and `makeModel` is never invoked. Returns
     * the final transcript text.
     */
    transcribeBatch?: (audio: Uint8Array, modelId: string, apiKey: string) => Promise<string>;
    /**
     * Optional factory for realtime/streaming models. Providers that
     * expose at least one model with `mode: 'realtime'` must implement
     * this; batch-only providers leave it undefined.
     */
    makeRealtimeModel?: (modelId: string, apiKey: string) => RealtimeModel;
    listModels: ((apiKey: string) => Promise<Model[]>) | null;
    defaultModels: Model[];
    pricing: Record<string, PricingEntry>;
    validateKey?: (apiKey: string) => Promise<boolean>;
}
