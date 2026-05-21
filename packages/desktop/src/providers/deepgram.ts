import { createDeepgram } from '@ai-sdk/deepgram';
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
    makeModel: (modelId, apiKey) => createDeepgram({ apiKey }).transcription(modelId),
    listModels: null,
    defaultModels: DEFAULT_MODELS,
    pricing: {
        'nova-3': { perMinuteUSD: 0.0043, lastUpdated: '2026-05-03' },
        'nova-2': { perMinuteUSD: 0.0043, lastUpdated: '2026-05-03' },
        enhanced: { perMinuteUSD: 0.0145, lastUpdated: '2026-05-03' },
    },
};
