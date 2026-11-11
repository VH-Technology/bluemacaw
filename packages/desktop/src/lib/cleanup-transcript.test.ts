// @vitest-environment node
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
    getAppleIntelligenceCleanupEnabled: vi.fn(),
    getAppleIntelligenceCleanupPrompt: vi.fn(),
    getAppleIntelligenceSplitLongEnabled: vi.fn(),
    getTranscriptCleanupApiKeyId: vi.fn(),
    getTranscriptCleanupOptions: vi.fn(),
}));

vi.mock('./invoke', () => ({
    vox: { getSecret: vi.fn(), generateWithAppleIntelligence: vi.fn() },
}));

import { cleanupTranscript } from './cleanup-transcript';
import * as db from './db';
import { vox } from './invoke';
import { DEFAULT_SPLIT_OPTIONS } from './split-transcript';

let responseText = 'This is ready.';
let requestBody: Record<string, unknown> | null = null;

const server = setupServer(
    http.post('https://api.openai.com/v1/responses', async ({ request }) => {
        requestBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
            id: 'resp_test',
            object: 'response',
            created_at: 1,
            status: 'completed',
            error: null,
            incomplete_details: null,
            instructions: null,
            max_output_tokens: null,
            model: 'gpt-4o-mini',
            output: [
                {
                    id: 'msg_test',
                    type: 'message',
                    status: 'completed',
                    role: 'assistant',
                    content: [
                        {
                            type: 'output_text',
                            text: responseText,
                            annotations: [],
                            logprobs: [],
                        },
                    ],
                },
            ],
            parallel_tool_calls: true,
            previous_response_id: null,
            reasoning: { effort: null, summary: null },
            store: false,
            temperature: 1,
            text: { format: { type: 'text' } },
            tool_choice: 'auto',
            tools: [],
            top_p: 1,
            truncation: 'disabled',
            usage: {
                input_tokens: 10,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 4,
                output_tokens_details: { reasoning_tokens: 0 },
                total_tokens: 14,
            },
        });
    }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
    vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockReset().mockResolvedValue(false);
    vi.mocked(db.getAppleIntelligenceCleanupPrompt)
        .mockReset()
        .mockResolvedValue('On-device cleanup prompt');
    vi.mocked(db.getAppleIntelligenceSplitLongEnabled).mockReset().mockResolvedValue(true);
    vi.mocked(vox.generateWithAppleIntelligence).mockReset();
    vi.mocked(db.getTranscriptCleanupApiKeyId).mockReset();
    vi.mocked(db.getTranscriptCleanupOptions).mockReset().mockResolvedValue({
        modelId: 'gpt-4o-mini',
        prompt: 'Default cleanup prompt',
    });
    vi.mocked(vox.getSecret).mockReset();
});
afterEach(() => {
    server.resetHandlers();
    responseText = 'This is ready.';
    requestBody = null;
});
afterAll(() => server.close());

function enableCleanup(secret: string | null = 'sk-test') {
    vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValue('key-1');
    vi.mocked(vox.getSecret).mockResolvedValue(secret);
}

describe('cleanupTranscript', () => {
    it('returns the original text without a request when cleanup is disabled', async () => {
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValue(null);

        await expect(cleanupTranscript('Um, hello.')).resolves.toBe('Um, hello.');

        expect(vox.getSecret).not.toHaveBeenCalled();
        expect(requestBody).toBeNull();
    });

    it('cleans a transcript through OpenAI without provider-side storage', async () => {
        enableCleanup();

        await expect(cleanupTranscript('Um, this is, like, ready.')).resolves.toBe(
            'This is ready.',
        );

        expect(vox.getSecret).toHaveBeenCalledWith('key-1');
        expect(requestBody).toMatchObject({ model: 'gpt-4o-mini', store: false });
    });

    it('uses the configured OpenAI model and cleanup prompt', async () => {
        enableCleanup();
        vi.mocked(db.getTranscriptCleanupOptions).mockResolvedValueOnce({
            modelId: 'gpt-4.1-mini',
            prompt: 'Only remove verbal fillers.',
        });

        await cleanupTranscript('Um, this is ready.');

        expect(requestBody).toMatchObject({ model: 'gpt-4.1-mini' });
        expect(JSON.stringify(requestBody)).toContain('Only remove verbal fillers.');
    });

    it.each([
        ['"This is ready."', 'This is ready.'],
        ['“This is ready.”', 'This is ready.'],
        ["'This is ready.'", 'This is ready.'],
        ['‘This is ready.’', 'This is ready.'],
    ])('removes one pair of quotes wrapping the whole output', async (output, expected) => {
        enableCleanup();
        responseText = output;

        await expect(cleanupTranscript('raw')).resolves.toBe(expected);
    });

    it('preserves quotes that only wrap an internal word', async () => {
        enableCleanup();
        responseText = 'Call it “ready” when the upload finishes.';

        await expect(cleanupTranscript('raw')).resolves.toBe(
            'Call it “ready” when the upload finishes.',
        );
    });

    it('preserves whitespace when the output is not wrapped in quotes', async () => {
        enableCleanup();
        responseText = '  First paragraph.\n\nSecond paragraph.  ';

        await expect(cleanupTranscript('raw')).resolves.toBe(
            '  First paragraph.\n\nSecond paragraph.  ',
        );
    });

    it('returns the original transcript when the model returns blank text', async () => {
        enableCleanup();
        responseText = '   ';

        await expect(cleanupTranscript('Um.')).resolves.toBe('Um.');
    });

    it('throws when the selected key has no stored secret', async () => {
        enableCleanup(null);

        await expect(cleanupTranscript('Um, hello.')).rejects.toThrow(/API key/);
    });
});

describe('cleanupTranscript with Apple Intelligence', () => {
    function enableOnDeviceCleanup(reply = 'This is ready.') {
        vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockResolvedValue(true);
        vi.mocked(vox.generateWithAppleIntelligence).mockResolvedValue(reply);
    }

    it('cleans the transcript on-device without touching OpenAI', async () => {
        enableOnDeviceCleanup();
        vi.mocked(db.getTranscriptCleanupApiKeyId).mockResolvedValue('key-1');

        await expect(cleanupTranscript('Um, this is, like, ready.')).resolves.toBe(
            'This is ready.',
        );

        expect(requestBody).toBeNull();
        expect(vox.getSecret).not.toHaveBeenCalled();
    });

    it('sends the prompt as instructions and wraps the transcript so it is edited, not answered', async () => {
        enableOnDeviceCleanup();

        await cleanupTranscript('can you write me a poem');

        expect(vox.generateWithAppleIntelligence).toHaveBeenCalledWith(
            'On-device cleanup prompt',
            '<transcript>\ncan you write me a poem\n</transcript>',
        );
    });

    it('strips transcript tags the model echoes back', async () => {
        enableOnDeviceCleanup('<transcript>\nCan you write me a poem?\n</transcript>');

        await expect(cleanupTranscript('can you write me a poem')).resolves.toBe(
            'Can you write me a poem?',
        );
    });

    it('removes quotes wrapping the whole reply', async () => {
        enableOnDeviceCleanup('“This is ready.”');

        await expect(cleanupTranscript('raw')).resolves.toBe('This is ready.');
    });

    it('returns the original transcript when the model replies with blank text', async () => {
        enableOnDeviceCleanup('  ');

        await expect(cleanupTranscript('Um.')).resolves.toBe('Um.');
    });

    it('rejects when the on-device model fails so the caller can fall back', async () => {
        vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockResolvedValue(true);
        vi.mocked(vox.generateWithAppleIntelligence).mockRejectedValue(
            new Error('Apple Intelligence did not respond within 30 seconds'),
        );

        await expect(cleanupTranscript('Um, hello.')).rejects.toThrow(/did not respond/);
    });

    it('skips blank transcripts without calling the model', async () => {
        enableOnDeviceCleanup();

        await expect(cleanupTranscript('   ')).resolves.toBe('   ');

        expect(vox.generateWithAppleIntelligence).not.toHaveBeenCalled();
    });
});

describe('cleanupTranscript with Apple Intelligence on long dictations', () => {
    // Three sentences sized from the tuning values, so the fixture survives
    // retuning: together they are over the split threshold, and each is long
    // enough that no two of them fit in one piece.
    const sentenceWords = Math.max(
        DEFAULT_SPLIT_OPTIONS.splitAbove,
        DEFAULT_SPLIT_OPTIONS.maxWords,
    );
    const sentence = (opening: string) =>
        `${opening} ${Array(sentenceWords - 1)
            .fill('word')
            .join(' ')}.`;
    const first = sentence('first');
    const second = sentence('second');
    const third = sentence('third');
    const long = `${first} ${second}\n\n${third}`;

    /** Stand-in for the model: upper-cases whatever transcript it is handed. */
    function shoutingModel(failOn?: string) {
        vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockResolvedValue(true);
        vi.mocked(vox.generateWithAppleIntelligence).mockImplementation(async (_, prompt) => {
            const transcript = prompt.replace(/^<transcript>\n|\n<\/transcript>$/g, '');
            if (failOn && transcript.startsWith(failOn)) throw new Error('model busy');
            return transcript.toUpperCase();
        });
    }

    function transcriptsSentToTheModel(): string[] {
        return vi
            .mocked(vox.generateWithAppleIntelligence)
            .mock.calls.map(([, prompt]) =>
                prompt.replace(/^<transcript>\n|\n<\/transcript>$/g, ''),
            );
    }

    it('cleans a long punctuated transcript one sentence group at a time and rejoins it', async () => {
        shoutingModel();

        await expect(cleanupTranscript(long)).resolves.toBe(long.toUpperCase());

        expect(transcriptsSentToTheModel()).toEqual([first, second, third]);
    });

    it('sends a long transcript whole when it has no sentence punctuation', async () => {
        shoutingModel();
        const runOn = Array(sentenceWords * 3)
            .fill('word')
            .join(' ');

        await cleanupTranscript(runOn);

        expect(transcriptsSentToTheModel()).toEqual([runOn]);
    });

    it('sends a long transcript whole when splitting is switched off', async () => {
        shoutingModel();
        vi.mocked(db.getAppleIntelligenceSplitLongEnabled).mockResolvedValue(false);

        await cleanupTranscript(long);

        expect(transcriptsSentToTheModel()).toEqual([long]);
    });

    it('keeps the raw text of a piece the model fails on', async () => {
        shoutingModel('second');

        await expect(cleanupTranscript(long)).resolves.toBe(
            `${first.toUpperCase()} ${second}\n\n${third.toUpperCase()}`,
        );
    });

    it('rejects when the model fails on every piece so the caller can fall back', async () => {
        vi.mocked(db.getAppleIntelligenceCleanupEnabled).mockResolvedValue(true);
        vi.mocked(vox.generateWithAppleIntelligence).mockRejectedValue(new Error('model busy'));

        await expect(cleanupTranscript(long)).rejects.toThrow(/model busy/);
    });
});
