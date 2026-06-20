import { createDeepgram } from '@ai-sdk/deepgram';
import { httpFetch } from '../lib/http';
import { makeFluxRealtimeModel } from './deepgram-flux-realtime';
import type { Model, ProviderConfig } from './types';

const DEFAULT_MODELS: Model[] = [
    {
        id: 'nova-3',
        displayName: 'Nova 3',
        description: 'Latest general-purpose model',
        mode: 'batch',
    },
    {
        id: 'nova-2',
        displayName: 'Nova 2',
        description: 'Previous-generation general-purpose model',
        mode: 'batch',
    },
    { id: 'enhanced', displayName: 'Enhanced', mode: 'batch' },
    {
        id: 'flux-general-en',
        displayName: 'Flux (English)',
        description: 'Purpose-built low-latency realtime model (~260 ms end-of-turn)',
        mode: 'realtime',
    },
];

export const deepgramConfig: ProviderConfig = {
    id: 'deepgram',
    name: 'Deepgram',
    logoSrc: '/logos/deepgram.svg',
    docsUrl: 'https://developers.deepgram.com/docs/pre-recorded-audio',
    apiKeyHelpUrl: 'https://console.deepgram.com/',
    pricingDocsUrl: 'https://deepgram.com/pricing',
    // Routed through Tauri's HTTP plugin (httpFetch): Deepgram's REST API
    // doesn't send CORS headers for the webview origin, so a browser fetch
    // dies at the preflight. The Rust-side request has no such restriction.
    makeModel: (modelId, apiKey) =>
        createDeepgram({ apiKey, fetch: httpFetch }).transcription(modelId),
    makeRealtimeModel: (modelId, apiKey) => makeFluxRealtimeModel(modelId, apiKey),
    listModels: null,
    defaultModels: DEFAULT_MODELS,
    pricing: {
        'nova-3': { perMinuteUSD: 0.0043, lastUpdated: '2026-05-03' },
        'nova-2': { perMinuteUSD: 0.0043, lastUpdated: '2026-05-03' },
        enhanced: { perMinuteUSD: 0.0145, lastUpdated: '2026-05-03' },
        // Flux English streaming, billed per second (~$0.0065/min). Re-verify
        // quarterly per spec §6.7.
        'flux-general-en': { perMinuteUSD: 0.0065, lastUpdated: '2026-06-20' },
    },
};
