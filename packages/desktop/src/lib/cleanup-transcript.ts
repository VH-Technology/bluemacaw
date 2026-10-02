import { type OpenAILanguageModelResponsesOptions, createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import {
    getAppleIntelligenceCleanupEnabled,
    getAppleIntelligenceCleanupPrompt,
    getAppleIntelligenceSplitLongEnabled,
    getTranscriptCleanupApiKeyId,
    getTranscriptCleanupOptions,
} from './db';
import { vox } from './invoke';
import { splitTranscript } from './split-transcript';

const CLEANUP_TIMEOUT_MS = 10_000;

const WRAPPING_QUOTES = new Map([
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
]);

// Echo of the delimiters `cleanupWithAppleIntelligence` wraps transcripts in.
const TRANSCRIPT_TAGS = /^\s*<transcript>\s*([\s\S]*?)\s*<\/transcript>\s*$/i;

function stripWrappingQuotes(text: string): string {
    const trimmed = text.trim();
    if (trimmed.length < 2) return text;
    const closing = WRAPPING_QUOTES.get(trimmed[0] ?? '');
    if (closing !== trimmed.at(-1)) return text;
    return trimmed.slice(1, -1).trim();
}

function finalize(output: string, original: string): string {
    const cleaned = stripWrappingQuotes(output);
    return cleaned.trim() ? cleaned : original;
}

/**
 * Post-process a finished transcript with whichever cleanup engine is on.
 * Returns the text unchanged when cleanup is off; rejects when the engine
 * fails, so the caller can fall back to the raw transcript.
 */
export async function cleanupTranscript(text: string): Promise<string> {
    if (!text.trim()) return text;
    if (await getAppleIntelligenceCleanupEnabled()) {
        return cleanupWithAppleIntelligence(text);
    }
    return cleanupWithOpenAI(text);
}

async function cleanupWithAppleIntelligence(text: string): Promise<string> {
    const [instructions, splitLong] = await Promise.all([
        getAppleIntelligenceCleanupPrompt(),
        getAppleIntelligenceSplitLongEnabled(),
    ]);
    const pieces = splitLong ? splitTranscript(text) : [];
    if (pieces.length < 2) return rewriteOnDevice(instructions, text);

    // One request per group of sentences keeps a long dictation inside the
    // model's context window and the per-request timeout. One at a time: the
    // model serves requests in turn anyway, so running them together only
    // makes the later ones time out while they queue. A group that fails keeps
    // its raw text; cleanup only fails if all of them do.
    let cleaned = '';
    let failures = 0;
    let firstFailure: unknown;
    for (const piece of pieces) {
        try {
            cleaned += (await rewriteOnDevice(instructions, piece.text)) + piece.gap;
        } catch (cause) {
            if (failures === 0) firstFailure = cause;
            failures += 1;
            cleaned += piece.text + piece.gap;
        }
    }
    if (failures === pieces.length) throw firstFailure;
    return cleaned;
}

async function rewriteOnDevice(instructions: string, text: string): Promise<string> {
    // Delimiting the transcript keeps the small on-device model editing
    // dictated questions and requests instead of answering them.
    const reply = await vox.generateWithAppleIntelligence(
        instructions,
        `<transcript>\n${text}\n</transcript>`,
    );
    return finalize(reply.replace(TRANSCRIPT_TAGS, '$1'), text);
}

async function cleanupWithOpenAI(text: string): Promise<string> {
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

    return finalize(result.text, text);
}
