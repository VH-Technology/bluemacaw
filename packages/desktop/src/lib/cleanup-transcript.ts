import { type OpenAILanguageModelResponsesOptions, createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { getTranscriptCleanupApiKeyId, getTranscriptCleanupOptions } from './db';
import { vox } from './invoke';

const CLEANUP_TIMEOUT_MS = 10_000;

const WRAPPING_QUOTES = new Map([
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
]);

function stripWrappingQuotes(text: string): string {
    const trimmed = text.trim();
    if (trimmed.length < 2) return text;
    const closing = WRAPPING_QUOTES.get(trimmed[0] ?? '');
    if (closing !== trimmed.at(-1)) return text;
    return trimmed.slice(1, -1).trim();
}

export async function cleanupTranscript(text: string): Promise<string> {
    if (!text.trim()) return text;

    const apiKeyId = await getTranscriptCleanupApiKeyId();
    if (!apiKeyId) return text;

    const [apiKey, options] = await Promise.all([
        vox.getSecret(apiKeyId),
        getTranscriptCleanupOptions(),
    ]);
    if (!apiKey) throw new Error('No API key stored for transcript cleanup');

    const openai = createOpenAI({ apiKey });
    const result = await generateText({
        model: openai.responses(options.modelId),
        system: options.prompt,
        prompt: text,
        temperature: 0,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS),
        providerOptions: {
            openai: {
                store: false,
            } satisfies OpenAILanguageModelResponsesOptions,
        },
    });

    const cleaned = stripWrappingQuotes(result.text);
    return cleaned.trim() ? cleaned : text;
}
