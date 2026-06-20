// @vitest-environment node
import { experimental_transcribe as transcribe } from 'ai';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assemblyaiConfig as cfg } from './assemblyai';

describe('assemblyai provider config', () => {
    it('has the required identity fields', () => {
        expect(cfg.id).toBe('assemblyai');
        expect(cfg.name).toBe('AssemblyAI');
        expect(cfg.docsUrl).toMatch(/^https:\/\//);
    });

    it('default models include the batch and streaming Universal-3 Pro models', () => {
        const ids = cfg.defaultModels.map((m) => m.id).sort();
        expect(ids).toEqual(['u3-rt-pro', 'universal-2', 'universal-3-pro']);
    });

    it('has pricing entries for every default model', () => {
        for (const m of cfg.defaultModels) {
            const entry = cfg.pricing[m.id];
            expect(entry).toBeDefined();
            expect(entry?.perMinuteUSD).toBeGreaterThan(0);
            // u3-rt-pro carries its own audit date; require a valid ISO date.
            expect(entry?.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it('exposes u3-rt-pro as a realtime model with makeRealtimeModel', () => {
        const streaming = cfg.defaultModels.find((m) => m.id === 'u3-rt-pro');
        expect(streaming?.mode).toBe('realtime');
        expect(cfg.makeRealtimeModel).toBeDefined();
    });

    it('listModels is null (AssemblyAI tier is configured by feature flags)', () => {
        expect(cfg.listModels).toBeNull();
    });

    it('makeModel returns a model object', () => {
        const m = cfg.makeModel('universal-3-pro', 'aai-test');
        expect(m).toBeDefined();
    });
});

describe('assemblyai transcription HTTP', () => {
    const server = setupServer();

    beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

    interface CapturedSubmit {
        authHeader: string | null;
        url: URL;
        body: Record<string, unknown>;
    }

    function setupHappyPath(): { submits: CapturedSubmit[] } {
        const submits: CapturedSubmit[] = [];
        server.use(
            http.post('https://api.assemblyai.com/v2/upload', ({ request }) => {
                const authHeader = request.headers.get('authorization');
                expect(authHeader).not.toBeNull();
                return HttpResponse.json({
                    upload_url: 'https://cdn.assemblyai.com/upload/fake-id',
                });
            }),
            http.post('https://api.assemblyai.com/v2/transcript', async ({ request }) => {
                submits.push({
                    authHeader: request.headers.get('authorization'),
                    url: new URL(request.url),
                    body: (await request.json()) as Record<string, unknown>,
                });
                return HttpResponse.json({ id: 'tr-1', status: 'queued' });
            }),
            http.get('https://api.assemblyai.com/v2/transcript/tr-1', () =>
                HttpResponse.json({
                    id: 'tr-1',
                    status: 'completed',
                    text: 'hello from assemblyai',
                    language_code: 'en',
                    words: [],
                    audio_duration: 1.5,
                }),
            ),
        );
        return { submits };
    }

    it('uploads audio, submits a job, polls for completion, and returns text', async () => {
        const { submits } = setupHappyPath();
        const model = cfg.makeModel('universal-3-pro', 'aai-test-key');
        const result = await transcribe({ model, audio: fakeAudio, maxRetries: 0 });

        expect(result.text).toBe('hello from assemblyai');
        expect(submits).toHaveLength(1);
        const first = submits[0];
        if (!first) throw new Error('expected submit to be captured');
        expect(first.authHeader).toBe('aai-test-key');
        expect(first.url.host).toBe('api.assemblyai.com');
        expect(first.url.pathname).toBe('/v2/transcript');
        // The submitted body references the uploaded audio.
        expect(first.body.audio_url).toBe('https://cdn.assemblyai.com/upload/fake-id');
    });

    it('rewrites the deprecated speech_model field to speech_models (plural array)', async () => {
        const { submits } = setupHappyPath();
        const model = cfg.makeModel('universal-3-pro', 'aai-test-key');
        await transcribe({ model, audio: fakeAudio, maxRetries: 0 });

        expect(submits).toHaveLength(1);
        const first = submits[0];
        if (!first) throw new Error('expected submit to be captured');
        const body = first.body;
        // The SDK sends `speech_model` (singular); our shim must translate.
        expect(body).not.toHaveProperty('speech_model');
        expect(body.speech_models).toEqual(['universal-3-pro']);
    });

    it('propagates 401 errors on upload', async () => {
        server.use(
            http.post('https://api.assemblyai.com/v2/upload', () =>
                HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
            ),
        );
        const model = cfg.makeModel('universal-3-pro', 'bad-key');
        await expect(transcribe({ model, audio: fakeAudio, maxRetries: 0 })).rejects.toThrow();
    });

    it('propagates 429 rate-limit errors on upload', async () => {
        server.use(
            http.post('https://api.assemblyai.com/v2/upload', () =>
                HttpResponse.json({ error: 'rate limited' }, { status: 429 }),
            ),
        );
        const model = cfg.makeModel('universal-3-pro', 'aai-test');
        await expect(transcribe({ model, audio: fakeAudio, maxRetries: 0 })).rejects.toThrow();
    });

    it('does not crash on a 500 with HTML body during upload', async () => {
        server.use(
            http.post('https://api.assemblyai.com/v2/upload', () =>
                HttpResponse.html('<html>upstream error</html>', { status: 500 }),
            ),
        );
        const model = cfg.makeModel('universal-3-pro', 'aai-test');
        await expect(transcribe({ model, audio: fakeAudio, maxRetries: 0 })).rejects.toThrow();
    });
});
