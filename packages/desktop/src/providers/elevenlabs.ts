import { createElevenLabs } from '@ai-sdk/elevenlabs';
import { makeScribeRealtimeModel } from './elevenlabs-realtime';
import type { Model, ProviderConfig } from './types';

// Order matters: the picker surfaces the first entry as the default for
// new model configs. Scribe v2 Realtime leads because it's the lowest-
// latency option (~150 ms end-to-end vs. v1's batch round trip).
const DEFAULT_MODELS: Model[] = [
    {
        id: 'scribe_v2_realtime',
        displayName: 'Scribe v2 Realtime',
        description: 'Low-latency streaming transcription (~150 ms)',
        mode: 'realtime',
    },
    {
        id: 'scribe_v1',
        displayName: 'Scribe v1',
        description: 'Batch transcription (best-in-class accuracy on long audio)',
        mode: 'batch',
    },
];

interface ElevenLabsModelEntry {
    model_id: string;
    name?: string;
    can_do_transcribe?: boolean;
}

export const elevenlabsConfig: ProviderConfig = {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    logoSrc: '/logos/elevenlabs.svg',
    docsUrl: 'https://elevenlabs.io/docs/capabilities/speech-to-text',
    apiKeyHelpUrl: 'https://elevenlabs.io/app/settings/api-keys',
    pricingDocsUrl: 'https://elevenlabs.io/pricing',
    makeModel: (modelId, apiKey) => createElevenLabs({ apiKey }).transcription(modelId),
    makeRealtimeModel: (modelId, apiKey) => makeScribeRealtimeModel(modelId, apiKey),
    listModels: async (apiKey) => {
        const res = await fetch('https://api.elevenlabs.io/v1/models', {
            headers: { 'xi-api-key': apiKey },
        });
        if (!res.ok) {
            throw new Error(`ElevenLabs listModels failed: ${res.status}`);
        }
        const body = (await res.json()) as ElevenLabsModelEntry[];
        return body
            .filter((m) => m.can_do_transcribe === true)
            .map((m) => ({
                id: m.model_id,
                displayName: m.name ?? m.model_id,
                mode: 'batch' as const,
            }));
    },
    defaultModels: DEFAULT_MODELS,
    pricing: {
        // Scribe v2 Realtime is on ElevenLabs' standard ASR tier alongside
        // v1; per the public pricing page ($6.67/1K min). Re-verify quarterly
        // per spec §6.7 audit cadence.
        scribe_v2_realtime: { perMinuteUSD: 0.00667, lastUpdated: '2026-05-18' },
        scribe_v1: { perMinuteUSD: 0.00667, lastUpdated: '2026-05-03' },
    },
};
