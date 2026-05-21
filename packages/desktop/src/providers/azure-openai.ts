import { createAzure } from '@ai-sdk/azure';
import type { ProviderConfig } from './types';

export const azureOpenaiConfig: ProviderConfig = {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    logoSrc: '/logos/azure-openai.svg',
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai/whisper-quickstart',
    apiKeyHelpUrl:
        'https://learn.microsoft.com/azure/ai-services/openai/how-to/role-based-access-control',
    pricingDocsUrl:
        'https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/',
    makeModel: (deploymentId, apiKey) => createAzure({ apiKey }).transcription(deploymentId),
    listModels: null,
    defaultModels: [{ id: 'whisper', displayName: 'Whisper (deployment)', mode: 'batch' }],
    pricing: {
        whisper: { perMinuteUSD: 0.006, lastUpdated: '2026-05-03' },
    },
};
