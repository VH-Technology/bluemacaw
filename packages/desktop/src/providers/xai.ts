import { httpFetch } from '../lib/http';
import type { Model, ProviderConfig } from './types';

// xAI's Grok speech-to-text is NOT a Vercel AI SDK provider, so there's no
// `createXai().transcription()` to lean on. We call its REST endpoint
// directly. Routed through Tauri's HTTP plugin (httpFetch) because, like
// Deepgram/Rev.ai, the endpoint isn't CORS-open to the webview origin.
//
// API: POST https://api.x.ai/v1/stt, Bearer auth, multipart/form-data with
// the audio under `file` (must be the last field). Response: { text, ... }.
// Docs: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
const STT_URL = 'https://api.x.ai/v1/stt';

const DEFAULT_MODELS: Model[] = [
    {
        id: 'grok-stt',
        displayName: 'Grok Speech-to-Text',
        description: 'xAI batch transcription (word timestamps, 25+ languages)',
        mode: 'batch',
    },
];

export const xaiConfig: ProviderConfig = {
    id: 'xai',
    name: 'Grok (xAI)',
    logoSrc: '/logos/xai.svg',
    docsUrl: 'https://docs.x.ai/developers/model-capabilities/audio/speech-to-text',
    apiKeyHelpUrl: 'https://console.x.ai/',
    pricingDocsUrl: 'https://docs.x.ai/docs/models',
    // Never called — transcribe() routes xAI through transcribeBatch below.
    // Present only to satisfy the ProviderConfig contract.
    makeModel: () => {
        throw new Error('xAI Grok uses transcribeBatch(); makeModel is not applicable.');
    },
    transcribeBatch: async (audio, _modelId, apiKey) => {
        const form = new FormData();
        // `file` must be the last form field per the xAI STT API.
        form.append('file', new Blob([audio.slice().buffer], { type: 'audio/wav' }), 'audio.wav');
        const res = await httpFetch(STT_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(`xAI STT request failed: ${res.status}${detail ? ` ${detail}` : ''}`);
        }
        const body = (await res.json()) as { text?: unknown };
        if (typeof body.text !== 'string') {
            throw new Error('xAI STT: response missing "text" field');
        }
        return body.text;
    },
    listModels: null,
    defaultModels: DEFAULT_MODELS,
    pricing: {
        // $0.10 / hour for batch STT (xAI launch pricing, 2026-04).
        'grok-stt': { perMinuteUSD: 0.1 / 60, lastUpdated: '2026-05-25' },
    },
};
