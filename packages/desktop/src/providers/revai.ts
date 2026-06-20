import { createRevai } from '@ai-sdk/revai';
import { httpFetch } from '../lib/http';
import type { Model, ProviderConfig } from './types';

const DEFAULT_MODELS: Model[] = [
    {
        id: 'machine',
        displayName: 'Machine',
        description: 'Asynchronous machine transcription tier',
        mode: 'batch',
    },
    {
        id: 'low_cost',
        displayName: 'Reverb Turbo',
        description: "Fast, low-cost async tier powered by Rev's Reverb Turbo model",
        mode: 'batch',
    },
    {
        id: 'fusion',
        displayName: 'Fusion',
        description: 'Higher-accuracy fusion transcription tier',
        mode: 'batch',
    },
];

export const revaiConfig: ProviderConfig = {
    id: 'revai',
    name: 'Rev.ai',
    logoSrc: '/logos/revai.svg',
    docsUrl: 'https://docs.rev.ai/api/asynchronous/',
    apiKeyHelpUrl: 'https://www.rev.ai/access-token',
    pricingDocsUrl: 'https://www.rev.ai/pricing',
    // Routed through Tauri's HTTP plugin (httpFetch): Rev.ai's API returns a
    // 204 preflight without Access-Control-Allow-Origin for the webview
    // origin, so a browser fetch is blocked by CORS. The Rust-side request
    // isn't.
    makeModel: (modelId, apiKey) =>
        createRevai({ apiKey, fetch: httpFetch }).transcription(
            modelId as 'machine' | 'low_cost' | 'fusion',
        ),
    listModels: null,
    defaultModels: DEFAULT_MODELS,
    pricing: {
        machine: { perMinuteUSD: 0.025, lastUpdated: '2026-05-03' },
        // Reverb Turbo is published at $0.10/hr ≈ $0.001667/min (the prior
        // 0.0167 figure was ~10× too high). Re-verify quarterly per spec §6.7.
        low_cost: { perMinuteUSD: 0.001667, lastUpdated: '2026-06-20' },
        fusion: { perMinuteUSD: 0.04, lastUpdated: '2026-05-03' },
    },
};
