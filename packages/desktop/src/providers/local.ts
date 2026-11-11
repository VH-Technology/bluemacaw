import { vox } from '../lib/invoke';
import type { Model, ProviderConfig } from './types';

export const DEFAULT_LOCAL_MODELS: Model[] = [
    {
        id: 'ggml-tiny.en',
        displayName: 'Whisper Tiny (English)',
        description: '~75 MB — fastest, weakest accuracy',
        mode: 'batch',
    },
    {
        id: 'ggml-tiny',
        displayName: 'Whisper Tiny (Multilingual)',
        description: '~75 MB — fastest, weakest accuracy',
        mode: 'batch',
    },
    {
        id: 'ggml-base.en',
        displayName: 'Whisper Base (English)',
        description: '~145 MB — quick drafts',
        mode: 'batch',
    },
    {
        id: 'ggml-base',
        displayName: 'Whisper Base (Multilingual)',
        description: '~145 MB — quick drafts',
        mode: 'batch',
    },
    {
        id: 'ggml-small.en',
        displayName: 'Whisper Small (English)',
        description: '~470 MB — good balance',
        mode: 'batch',
    },
    {
        id: 'ggml-small',
        displayName: 'Whisper Small (Multilingual)',
        description: '~470 MB — good balance',
        mode: 'batch',
    },
    {
        id: 'ggml-medium.en',
        displayName: 'Whisper Medium (English)',
        description: '~1.5 GB — best accuracy/speed tradeoff',
        mode: 'batch',
    },
    {
        id: 'ggml-medium',
        displayName: 'Whisper Medium (Multilingual)',
        description: '~1.5 GB — best accuracy/speed tradeoff',
        mode: 'batch',
    },
    {
        id: 'ggml-large-v3',
        displayName: 'Whisper Large v3 (Multilingual)',
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
