// @vitest-environment node
import { experimental_transcribe as transcribe } from 'ai';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gladiaConfig as cfg } from './gladia';

describe('gladia provider config', () => {
    it('has the required identity fields', () => {
        expect(cfg.id).toBe('gladia');
        expect(cfg.name).toBe('Gladia');
        expect(cfg.docsUrl).toMatch(/^https:\/\//);
    });

    it('has at least one default model', () => {
        expect(cfg.defaultModels.length).toBeGreaterThan(0);
    });

    it('has pricing entries for every default model', () => {
        for (const m of cfg.defaultModels) {
            const entry = cfg.pricing[m.id];
            expect(entry).toBeDefined();
            expect(entry?.perMinuteUSD).toBeGreaterThan(0);
            // Solaria entries were audited 2026-06-20; require a valid ISO
            // date rather than one shared value.
            expect(entry?.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it('default models are solaria-1 and solaria-3', () => {
        const ids = cfg.defaultModels.map((m) => m.id).sort();
        expect(ids).toEqual(['solaria-1', 'solaria-3']);
    });

    it('listModels is null (Gladia exposes a single transcription model)', () => {
        expect(cfg.listModels).toBeNull();
    });

    it('makeModel returns a model object regardless of supplied id', () => {
        const m = cfg.makeModel('whisper-large-v3', 'gladia-test');
        expect(m).toBeDefined();
    });
});

describe('gladia transcription HTTP', () => {
    const server = setupServer();

    beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

    const goodResult = {
        status: 'done' as const,
        result: {
            metadata: { audio_duration: 1.5 },
            transcription: {
                full_transcript: 'hello from gladia',
                languages: ['en'],
                utterances: [{ start: 0, end: 1.5, text: 'hello from gladia' }],
            },
        },
    };

    interface Captured {
        uploadKey: string | null;
        submitKey: string | null;
        submitUrl: URL;
        submitBody: Record<string, unknown>;
        pollKey: string | null;
    }

    function setupHappyPath(): { captured: Captured } {
        const captured: Captured = {
            uploadKey: null,
            submitKey: null,
            submitUrl: new URL('https://placeholder.invalid/'),
            submitBody: {},
            pollKey: null,
        };
        server.use(
            http.post('https://api.gladia.io/v2/upload', ({ request }) => {
                captured.uploadKey = request.headers.get('x-gladia-key');
                return HttpResponse.json({
                    audio_url: 'https://cdn.gladia.io/uploads/fake.wav',
                });
            }),
            http.post('https://api.gladia.io/v2/pre-recorded', async ({ request }) => {
                captured.submitKey = request.headers.get('x-gladia-key');
                captured.submitUrl = new URL(request.url);
                captured.submitBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json({
                    id: 'gladia-job-1',
                    result_url: 'https://api.gladia.io/v2/pre-recorded/gladia-job-1',
                });
            }),
            http.get('https://api.gladia.io/v2/pre-recorded/gladia-job-1', ({ request }) => {
                captured.pollKey = request.headers.get('x-gladia-key');
                return HttpResponse.json(goodResult);
            }),
        );
        return { captured };
    }

    it('uploads, submits, polls, and returns text using x-gladia-key auth', async () => {
        const { captured } = setupHappyPath();
        const model = cfg.makeModel('solaria-1', 'gladia-test-key');
        const result = await transcribe({ model, audio: fakeAudio, maxRetries: 0 });

        expect(result.text).toBe('hello from gladia');
        expect(captured.uploadKey).toBe('gladia-test-key');
        expect(captured.submitKey).toBe('gladia-test-key');
        expect(captured.pollKey).toBe('gladia-test-key');
        expect(captured.submitUrl.host).toBe('api.gladia.io');
        expect(captured.submitUrl.pathname).toBe('/v2/pre-recorded');
        expect(captured.submitBody.audio_url).toBe('https://cdn.gladia.io/uploads/fake.wav');
    });

    it('injects the selected model into the pre-recorded submit body', async () => {
        const { captured } = setupHappyPath();
        const model = cfg.makeModel('solaria-3', 'gladia-test-key');
        await transcribe({ model, audio: fakeAudio, maxRetries: 0 });
        expect(captured.submitBody.model).toBe('solaria-3');
    });

    it('maps the legacy whisper-large-v3 id forward to solaria-1', async () => {
        const { captured } = setupHappyPath();
        const model = cfg.makeModel('whisper-large-v3', 'gladia-test-key');
        await transcribe({ model, audio: fakeAudio, maxRetries: 0 });
        expect(captured.submitBody.model).toBe('solaria-1');
    });

    it('propagates 401 unauthorized errors on upload', async () => {
        server.use(
            http.post('https://api.gladia.io/v2/upload', () =>
                HttpResponse.json({ message: 'unauthorized' }, { status: 401 }),
            ),
        );
        const model = cfg.makeModel('whisper-large-v3', 'bad-key');
        await expect(transcribe({ model, audio: fakeAudio, maxRetries: 0 })).rejects.toThrow();
    });

    it('propagates 429 rate-limit errors on upload', async () => {
        server.use(
            http.post('https://api.gladia.io/v2/upload', () =>
                HttpResponse.json({ message: 'rate limited' }, { status: 429 }),
            ),
        );
        const model = cfg.makeModel('whisper-large-v3', 'gladia-test');
        await expect(transcribe({ model, audio: fakeAudio, maxRetries: 0 })).rejects.toThrow();
    });

    it('does not crash on a 500 with HTML body during upload', async () => {
        server.use(
            http.post('https://api.gladia.io/v2/upload', () =>
                HttpResponse.html('<html>upstream error</html>', { status: 500 }),
            ),
        );
        const model = cfg.makeModel('whisper-large-v3', 'gladia-test');
        await expect(transcribe({ model, audio: fakeAudio, maxRetries: 0 })).rejects.toThrow();
    });
});
