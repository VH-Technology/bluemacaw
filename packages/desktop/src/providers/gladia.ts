import { createGladia } from '@ai-sdk/gladia';
import { httpFetch } from '../lib/http';
import type { ProviderConfig } from './types';

export const gladiaConfig: ProviderConfig = {
    id: 'gladia',
    name: 'Gladia',
    logoSrc: '/logos/gladia.svg',
    docsUrl: 'https://docs.gladia.io/chapters/pre-recorded-stt/getting-started',
    apiKeyHelpUrl: 'https://app.gladia.io/account',
    pricingDocsUrl: 'https://gladia.io/pricing',
    // Routed through Tauri's HTTP plugin (httpFetch) to bypass webview CORS,
    // matching Deepgram/Rev.ai.
    makeModel: (_modelId, apiKey) => createGladia({ apiKey, fetch: httpFetch }).transcription(),
    listModels: null,
    defaultModels: [{ id: 'whisper-large-v3', displayName: 'Whisper Large v3', mode: 'batch' }],
    pricing: {
        'whisper-large-v3': { perMinuteUSD: 0.0102, lastUpdated: '2026-05-03' },
    },
};
