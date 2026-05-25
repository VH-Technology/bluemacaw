import { createDeepgram } from '@ai-sdk/deepgram';
import { httpFetch } from '../lib/http';
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
    listModels: null,
    defaultModels: DEFAULT_MODELS,
    pricing: {
        'nova-3': { perMinuteUSD: 0.0043, lastUpdated: '2026-05-03' },
        'nova-2': { perMinuteUSD: 0.0043, lastUpdated: '2026-05-03' },
        enhanced: { perMinuteUSD: 0.0145, lastUpdated: '2026-05-03' },
    },
};
