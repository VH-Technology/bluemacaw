import { assemblyaiConfig } from './assemblyai';
import { azureOpenaiConfig } from './azure-openai';
import { deepgramConfig } from './deepgram';
import { elevenlabsConfig } from './elevenlabs';
import { falConfig } from './fal';
import { gladiaConfig } from './gladia';
import { groqConfig } from './groq';
import { openaiConfig } from './openai';
import { revaiConfig } from './revai';
import type { ProviderConfig } from './types';
import { xaiConfig } from './xai';

export const PROVIDERS: readonly ProviderConfig[] = [
    assemblyaiConfig,
    azureOpenaiConfig,
    deepgramConfig,
    elevenlabsConfig,
    falConfig,
    gladiaConfig,
    groqConfig,
    openaiConfig,
    revaiConfig,
    xaiConfig,
] as const;

export type { Model, PricingEntry, ProviderConfig } from './types';
