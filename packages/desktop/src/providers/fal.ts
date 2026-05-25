import { createFal } from '@ai-sdk/fal';
import { httpFetch } from '../lib/http';
import type { Model, ProviderConfig } from './types';

const DEFAULT_MODELS: Model[] = [
    {
        id: 'whisper',
        displayName: 'Whisper',
        description: 'OpenAI Whisper hosted by Fal',
        mode: 'batch',
    },
    {
        id: 'wizper',
        displayName: 'Wizper',
        description: 'Fal-tuned Whisper variant',
        mode: 'batch',
    },
];

export const falConfig: ProviderConfig = {
    id: 'fal',
    name: 'Fal',
    logoSrc: '/logos/fal.svg',
    docsUrl: 'https://fal.ai/models/fal-ai/whisper',
    apiKeyHelpUrl: 'https://fal.ai/dashboard/keys',
    pricingDocsUrl: 'https://fal.ai/pricing',
    // Routed through Tauri's HTTP plugin (httpFetch) to bypass webview CORS,
    // matching Deepgram/Rev.ai.
    makeModel: (modelId, apiKey) => createFal({ apiKey, fetch: httpFetch }).transcription(modelId),
    listModels: null,
    defaultModels: DEFAULT_MODELS,
    pricing: {
        whisper: { perMinuteUSD: 0.005, lastUpdated: '2026-05-03' },
        wizper: { perMinuteUSD: 0.0125, lastUpdated: '2026-05-03' },
    },
};
