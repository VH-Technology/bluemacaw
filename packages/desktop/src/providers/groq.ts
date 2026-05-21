import { createGroq } from '@ai-sdk/groq';
import type { Model, ProviderConfig } from './types';

const DEFAULT_MODELS: Model[] = [
    { id: 'whisper-large-v3', displayName: 'Whisper Large v3', mode: 'batch' },
    { id: 'whisper-large-v3-turbo', displayName: 'Whisper Large v3 Turbo', mode: 'batch' },
];

/**
 * Groq retired `distil-whisper-large-v3-en` on 2025-08-23 (see
 * https://console.groq.com/docs/deprecations). The recommended replacement
 * is `whisper-large-v3-turbo`. Translate any persisted user configs that
 * still reference the old id so they don't break on next transcription.
 */
const LEGACY_MODEL_ALIASES: Record<string, string> = {
    'distil-whisper-large-v3-en': 'whisper-large-v3-turbo',
};

function resolveModelId(id: string): string {
    return LEGACY_MODEL_ALIASES[id] ?? id;
}

function isTranscriptionModel(id: string): boolean {
    return id.includes('whisper');
}

export const groqConfig: ProviderConfig = {
    id: 'groq',
    name: 'Groq',
    logoSrc: '/logos/groq.svg',
    docsUrl: 'https://console.groq.com/docs/speech-text',
    apiKeyHelpUrl: 'https://console.groq.com/keys',
    pricingDocsUrl: 'https://groq.com/pricing/',
    makeModel: (modelId, apiKey) => createGroq({ apiKey }).transcription(resolveModelId(modelId)),
    listModels: async (apiKey) => {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) {
            throw new Error(`Groq listModels failed: ${res.status}`);
        }
        const body = (await res.json()) as { data: Array<{ id: string }> };
        return body.data
            .filter((m) => isTranscriptionModel(m.id))
            .map((m) => ({
                id: m.id,
                displayName: DEFAULT_MODELS.find((d) => d.id === m.id)?.displayName ?? m.id,
                mode: 'batch' as const,
            }));
    },
    defaultModels: DEFAULT_MODELS,
    pricing: {
        'whisper-large-v3': {
            perMinuteUSD: 0.000185,
            lastUpdated: '2026-05-11',
        },
        'whisper-large-v3-turbo': {
            perMinuteUSD: 0.00006666,
            lastUpdated: '2026-05-11',
        },
    },
};
