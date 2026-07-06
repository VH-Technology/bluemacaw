import { vox } from '../lib/invoke';
import type { Model, ProviderConfig } from './types';

const DEFAULT_LOCAL_MODELS: Model[] = [
    {
        id: 'ggml-tiny.en',
        displayName: 'Tiny (English)',
        description: '~75 MB — fastest, weakest accuracy',
        mode: 'batch',
    },
    {
        id: 'ggml-base.en',
        displayName: 'Base (English)',
        description: '~145 MB — quick drafts',
        mode: 'batch',
    },
    {
        id: 'ggml-small.en',
        displayName: 'Small (English)',
        description: '~470 MB — good balance',
        mode: 'batch',
    },
    {
        id: 'ggml-medium.en',
        displayName: 'Medium (English)',
        description: '~1.5 GB — best accuracy/speed tradeoff',
        mode: 'batch',
    },
    {
        id: 'ggml-large-v3',
        displayName: 'Large v3',
        description: '~3 GB — maximum accuracy',
        mode: 'batch',
    },
];

export const localConfig: ProviderConfig = {
    id: 'local',
    name: 'Local (on-device)',
    logoSrc: '/logos/local.svg',
    docsUrl: 'https://github.com/ggerganov/whisper.cpp',
    apiKeyHelpUrl: '',
    pricingDocsUrl: '',
    makeModel: () => {
        throw new Error(
            'Local model: transcription should go through transcribeBatch, not makeModel',
        );
    },
    transcribeBatch: async (audio: Uint8Array, modelId: string, _apiKey: string) => {
        return await vox.transcribeLocal(audio, modelId);
    },
    makeRealtimeModel: undefined,
    listModels: null,
    defaultModels: DEFAULT_LOCAL_MODELS,
    pricing: {},
    validateKey: async () => true,
};
