import { createGladia } from '@ai-sdk/gladia';
import { httpFetch } from '../lib/http';
import type { Model, ProviderConfig } from './types';

const DEFAULT_MODELS: Model[] = [
    {
        id: 'solaria-1',
        displayName: 'Solaria 1',
        description: "Gladia's general-purpose model (100+ languages); the API default",
        mode: 'batch',
    },
    {
        id: 'solaria-3',
        displayName: 'Solaria 3',
        description: 'Highest-accuracy model for English & major European languages',
        mode: 'batch',
    },
];

/**
 * Legacy Gladia model ids. The previous build labeled its single model
 * `whisper-large-v3`, but the @ai-sdk/gladia adapter never actually sent a
 * model field — requests fell back to Gladia's default, which is now
 * Solaria-1. Map the old id forward so persisted configs keep working.
 */
const LEGACY_MODEL_ALIASES: Record<string, string> = {
    'whisper-large-v3': 'solaria-1',
};

function resolveModelId(id: string): string {
    return LEGACY_MODEL_ALIASES[id] ?? id;
}

function requestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input.url;
}

/**
 * `@ai-sdk/gladia@2.0.33` hardcodes the model to Gladia's default and
 * exposes no way to pick Solaria-3. We wrap the SDK's fetch and inject the
 * selected `model` into the JSON body of the `/v2/pre-recorded` submit
 * request. The multipart `/v2/upload` call and any non-JSON body pass
 * through untouched. Routed through `httpFetch` to bypass webview CORS
 * (matching Deepgram/Rev.ai); `httpFetch` falls back to the global fetch in
 * unit tests so MSW still intercepts.
 *
 * Remove this shim once `@ai-sdk/gladia` exposes a model option.
 */
function makeModelInjectingFetch(modelId: string): typeof globalThis.fetch {
    return async (input, init) => {
        let outInit = init;
        if (
            init?.body &&
            typeof init.body === 'string' &&
            requestUrl(input).includes('/v2/pre-recorded')
        ) {
            try {
                const parsed = JSON.parse(init.body) as Record<string, unknown>;
                if (parsed && typeof parsed === 'object' && !('model' in parsed)) {
                    outInit = { ...init, body: JSON.stringify({ ...parsed, model: modelId }) };
                }
            } catch {
                // body wasn't JSON — leave it alone
            }
        }
        return httpFetch(input, outInit);
    };
}

export const gladiaConfig: ProviderConfig = {
    id: 'gladia',
    name: 'Gladia',
    logoSrc: '/logos/gladia.svg',
    docsUrl: 'https://docs.gladia.io/chapters/pre-recorded-stt/getting-started',
    apiKeyHelpUrl: 'https://app.gladia.io/account',
    pricingDocsUrl: 'https://gladia.io/pricing',
    makeModel: (modelId, apiKey) =>
        createGladia({
            apiKey,
            fetch: makeModelInjectingFetch(resolveModelId(modelId)),
        }).transcription(),
    listModels: null,
    defaultModels: DEFAULT_MODELS,
    pricing: {
        // Solaria-1 and Solaria-3 share Gladia's async rate ($0.61/hr ≈
        // $0.0102/min). Re-verify quarterly per spec §6.7.
        'solaria-1': { perMinuteUSD: 0.0102, lastUpdated: '2026-06-20' },
        'solaria-3': { perMinuteUSD: 0.0102, lastUpdated: '2026-06-20' },
        // Legacy id retained so old persisted configs still price correctly.
        'whisper-large-v3': { perMinuteUSD: 0.0102, lastUpdated: '2026-05-03' },
    },
};
