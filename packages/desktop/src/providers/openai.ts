import { createOpenAI } from '@ai-sdk/openai';
import type { Model, ProviderConfig } from './types';

const KNOWN_TRANSCRIPTION_IDS = new Set([
    'whisper-1',
    'gpt-4o-transcribe',
    'gpt-4o-mini-transcribe',
]);

const DEFAULT_MODELS: Model[] = [
    { id: 'whisper-1', displayName: 'Whisper 1', mode: 'batch' },
    { id: 'gpt-4o-transcribe', displayName: 'GPT-4o Transcribe', mode: 'batch' },
    { id: 'gpt-4o-mini-transcribe', displayName: 'GPT-4o Mini Transcribe', mode: 'batch' },
];

export const openaiConfig: ProviderConfig = {
    id: 'openai',
    name: 'OpenAI',
    logoSrc: '/logos/openai.svg',
    docsUrl: 'https://platform.openai.com/docs/guides/speech-to-text',
    apiKeyHelpUrl: 'https://platform.openai.com/api-keys',
    pricingDocsUrl: 'https://openai.com/api/pricing/',
    makeModel: (modelId, apiKey) => createOpenAI({ apiKey }).transcription(modelId),
    listModels: async (apiKey) => {
        const res = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) {
            throw new Error(`OpenAI listModels failed: ${res.status}`);
        }
        const body = (await res.json()) as { data: Array<{ id: string }> };
        return body.data
            .filter((m) => KNOWN_TRANSCRIPTION_IDS.has(m.id))
            .map((m) => ({
                id: m.id,
                displayName: DEFAULT_MODELS.find((d) => d.id === m.id)?.displayName ?? m.id,
                mode: 'batch' as const,
            }));
    },
    defaultModels: DEFAULT_MODELS,
    pricing: {
        'whisper-1': { perMinuteUSD: 0.006, lastUpdated: '2026-05-03' },
        'gpt-4o-transcribe': {
            perMinuteUSD: 0.006,
            lastUpdated: '2026-05-03',
        },
        'gpt-4o-mini-transcribe': {
            perMinuteUSD: 0.003,
            lastUpdated: '2026-05-03',
        },
    },
};
