// @vitest-environment node
import { experimental_transcribe as transcribe } from 'ai';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { deepgramConfig as cfg } from './deepgram';

describe('deepgram provider config', () => {
    it('has the required identity fields', () => {
        expect(cfg.id).toBe('deepgram');
        expect(cfg.name).toBe('Deepgram');
        expect(cfg.docsUrl).toMatch(/^https:\/\//);
    });

    it('exposes more than one default model', () => {
        expect(cfg.defaultModels.length).toBeGreaterThan(1);
    });

    it('default model ids include nova-3 and nova-2', () => {
        const ids = cfg.defaultModels.map((m) => m.id);
        expect(ids).toContain('nova-3');
        expect(ids).toContain('nova-2');
    });

    it('has pricing entries for every default model', () => {
        for (const m of cfg.defaultModels) {
            const entry = cfg.pricing[m.id];
            expect(entry).toBeDefined();
            expect(entry?.perMinuteUSD).toBeGreaterThan(0);
            // Flux carries its own audit date (2026-06-20); require a valid
            // ISO date rather than one shared value.
            expect(entry?.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it('exposes flux-general-en as a realtime model with makeRealtimeModel', () => {
        const flux = cfg.defaultModels.find((m) => m.id === 'flux-general-en');
        expect(flux?.mode).toBe('realtime');
        expect(cfg.makeRealtimeModel).toBeDefined();
    });

    it('listModels is null (Deepgram uses hardcoded list)', () => {
        expect(cfg.listModels).toBeNull();
    });

    it('makeModel returns a model object', () => {
        const m = cfg.makeModel('nova-3', 'dg-test');
        expect(m).toBeDefined();
    });
});

describe('deepgram transcription HTTP', () => {
    const server = setupServer();

    beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

    it('POSTs audio to api.deepgram.com/v1/listen with Token auth and includes model query', async () => {
        const captured: {
            auth: string | null;
            url: URL | null;
            contentType: string | null;
        } = { auth: null, url: null, contentType: null };
        server.use(
            http.post('https://api.deepgram.com/v1/listen', ({ request }) => {
                captured.auth = request.headers.get('authorization');
                captured.contentType = request.headers.get('content-type');
                captured.url = new URL(request.url);
                return HttpResponse.json({
                    metadata: { duration: 1.5 },
                    results: {
                        channels: [
                            {
                                detected_language: 'en',
                                alternatives: [{ transcript: 'hello from deepgram', words: [] }],
                            },
                        ],
                    },
                });
            }),
        );

        const model = cfg.makeModel('nova-3', 'dg-test-key');
        const result = await transcribe({ model, audio: fakeAudio, maxRetries: 0 });

        expect(result.text).toBe('hello from deepgram');
        expect(captured.auth).toBe('Token dg-test-key');
        expect(captured.url?.host).toBe('api.deepgram.com');
        expect(captured.url?.pathname).toBe('/v1/listen');
        expect(captured.url?.searchParams.get('model')).toBe('nova-3');
        expect(captured.contentType).toBeTruthy();
    });

    it('propagates 401 unauthorized errors', async () => {
        server.use(
            http.post('https://api.deepgram.com/v1/listen', () =>
                HttpResponse.json({ err_code: 'INVALID_AUTH' }, { status: 401 }),
            ),
        );
        const model = cfg.makeModel('nova-3', 'bad-key');
        await expect(transcribe({ model, audio: fakeAudio, maxRetries: 0 })).rejects.toThrow();
    });

    it('propagates 429 rate-limit errors', async () => {
        server.use(
            http.post('https://api.deepgram.com/v1/listen', () =>
                HttpResponse.json({ err_code: 'RATE_LIMIT' }, { status: 429 }),
            ),
        );
        const model = cfg.makeModel('nova-3', 'dg-test');
        await expect(transcribe({ model, audio: fakeAudio, maxRetries: 0 })).rejects.toThrow();
    });

    it('does not crash on a 500 with non-JSON HTML body', async () => {
        server.use(
            http.post('https://api.deepgram.com/v1/listen', () =>
                HttpResponse.html('<html><body>upstream gateway error</body></html>', {
                    status: 500,
                }),
            ),
        );
        const model = cfg.makeModel('nova-3', 'dg-test');
        await expect(transcribe({ model, audio: fakeAudio, maxRetries: 0 })).rejects.toThrow();
    });
});
