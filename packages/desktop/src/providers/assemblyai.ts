import { createAssemblyAI } from '@ai-sdk/assemblyai';
import { httpFetch } from '../lib/http';
import type { Model, ProviderConfig } from './types';

const DEFAULT_MODELS: Model[] = [
    {
        id: 'universal-3-pro',
        displayName: 'Universal 3 Pro',
        description: 'AssemblyAI flagship transcription model (highest accuracy)',
        mode: 'batch',
    },
    {
        id: 'universal-2',
        displayName: 'Universal 2',
        description: 'AssemblyAI previous-generation transcription model',
        mode: 'batch',
    },
];

/**
 * Legacy AssemblyAI model IDs that the API no longer accepts. We translate
 * them on the fly so users who picked them before the migration don't have
 * to re-create their model configs. The mapping mirrors AssemblyAI's own
 * migration guidance.
 */
const LEGACY_MODEL_ALIASES: Record<string, string> = {
    best: 'universal-3-pro',
    nano: 'universal-2',
};

function normalizeModelId(modelId: unknown): string | unknown {
    if (typeof modelId !== 'string') return modelId;
    return LEGACY_MODEL_ALIASES[modelId] ?? modelId;
}

/**
 * AssemblyAI deprecated the `speech_model` (singular) field in favor of
 * `speech_models` (plural array) on 2026-05-10. `@ai-sdk/assemblyai@2.0.33`
 * still sends the deprecated form and the API now rejects it outright with:
 *   { "error": "speech_model is deprecated. Use \"speech_models\" instead." }
 *
 * Until Vercel ships a fix upstream, we wrap the SDK's `fetch` and rewrite
 * the request body on the way out: { speech_model: "best" } becomes
 * { speech_models: ["best"] }. Binary uploads (audio bytes) and any
 * non-JSON bodies pass through untouched.
 *
 * Remove this shim once `@ai-sdk/assemblyai` ships the rename.
 */
const rewritingFetch: typeof globalThis.fetch = async (input, init) => {
    let outInit = init;
    if (init?.body && typeof init.body === 'string') {
        try {
            const parsed = JSON.parse(init.body) as Record<string, unknown>;
            if (
                parsed &&
                typeof parsed === 'object' &&
                'speech_model' in parsed &&
                !('speech_models' in parsed)
            ) {
                const { speech_model, ...rest } = parsed;
                const rewritten = {
                    ...rest,
                    speech_models: [normalizeModelId(speech_model)],
                };
                outInit = { ...init, body: JSON.stringify(rewritten) };
            }
        } catch {
            // body wasn't JSON — leave it alone
        }
    }
    // Routed through Tauri's HTTP plugin (httpFetch) to bypass webview CORS,
    // matching Deepgram/Rev.ai. httpFetch falls back to the global fetch
    // outside a Tauri runtime (unit tests), so MSW still intercepts.
    return httpFetch(input, outInit);
};

export const assemblyaiConfig: ProviderConfig = {
    id: 'assemblyai',
    name: 'AssemblyAI',
    logoSrc: '/logos/assemblyai.svg',
    docsUrl: 'https://www.assemblyai.com/docs/speech-to-text/pre-recorded-audio',
    apiKeyHelpUrl: 'https://www.assemblyai.com/app/api-keys',
    pricingDocsUrl: 'https://www.assemblyai.com/pricing',
    makeModel: (modelId, apiKey) =>
        // The SDK's TranscriptionModelId type still expects the old
        // 'best' | 'nano' literals; passing the new universal-* strings is
        // a small type cast away. Wherever the modelId actually ends up in
        // the request body, our `rewritingFetch` translates it before send.
        createAssemblyAI({ apiKey, fetch: rewritingFetch }).transcription(
            modelId as 'best' | 'nano',
        ),
    listModels: null,
    defaultModels: DEFAULT_MODELS,
    pricing: {
        // Pricing as published at https://www.assemblyai.com/pricing on
        // 2026-05-11. Per AssemblyAI's pricing page: Universal 3 Pro and
        // Universal 2 are both billed at the standard transcription rate.
        // Re-verify quarterly per spec §6.7 audit cadence.
        'universal-3-pro': { perMinuteUSD: 0.00617, lastUpdated: '2026-05-11' },
        'universal-2': { perMinuteUSD: 0.00617, lastUpdated: '2026-05-11' },
    },
};
