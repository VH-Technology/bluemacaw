// @vitest-environment node
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({
    getTranscriptCleanupApiKeyId: vi.fn(),
    getTranscriptCleanupOptions: vi.fn(),
}));

vi.mock('./invoke', () => ({
    vox: { getSecret: vi.fn() },
}));

import { cleanupTranscript } from './cleanup-transcript';
import * as db from './db';
import { vox } from './invoke';

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
