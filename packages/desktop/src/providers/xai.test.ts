// @vitest-environment node
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { xaiConfig as cfg } from './xai';

describe('xai provider config', () => {
    it('has the required identity fields', () => {
        expect(cfg.id).toBe('xai');
        expect(cfg.name).toMatch(/grok/i);
        expect(cfg.docsUrl).toMatch(/^https:\/\//);
    });

    it('exposes a batch transcription model with pricing', () => {
        expect(cfg.defaultModels.length).toBeGreaterThan(0);
        for (const m of cfg.defaultModels) {
            expect(m.mode).toBe('batch');
            expect(cfg.pricing[m.id]?.perMinuteUSD).toBeGreaterThan(0);
        }
    });

    it('uses the transcribeBatch escape hatch (no AI SDK adapter)', () => {
        expect(typeof cfg.transcribeBatch).toBe('function');
    });

    it('makeModel throws — xAI is driven through transcribeBatch', () => {
        expect(() => cfg.makeModel('grok-stt', 'k')).toThrow();
    });
});

describe('xai transcribeBatch HTTP', () => {
    const server = setupServer();
    beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]);

    it('POSTs multipart audio to api.x.ai/v1/stt with Bearer auth and returns text', async () => {
        const captured: { auth: string | null; ct: string | null; path: string | null } = {
            auth: null,
            ct: null,
            path: null,
        };
        server.use(
            http.post('https://api.x.ai/v1/stt', ({ request }) => {
                captured.auth = request.headers.get('authorization');
                captured.ct = request.headers.get('content-type');
                captured.path = new URL(request.url).pathname;
                return HttpResponse.json({
                    text: 'hello from grok',
                    language: 'English',
                    duration: 1.2,
                    words: [],
                });
            }),
        );

        const text = await cfg.transcribeBatch?.(audio, 'grok-stt', 'xai-test-key');

        expect(text).toBe('hello from grok');
        expect(captured.auth).toBe('Bearer xai-test-key');
        expect(captured.ct).toMatch(/multipart\/form-data/);
        expect(captured.path).toBe('/v1/stt');
    });

    it('throws on a 401 unauthorized response', async () => {
        server.use(
            http.post('https://api.x.ai/v1/stt', () =>
                HttpResponse.json({ error: 'invalid api key' }, { status: 401 }),
            ),
        );
        await expect(cfg.transcribeBatch?.(audio, 'grok-stt', 'bad-key')).rejects.toThrow();
    });

    it('throws when the response has no text field', async () => {
        server.use(
            http.post('https://api.x.ai/v1/stt', () => HttpResponse.json({ language: 'en' })),
        );
        await expect(cfg.transcribeBatch?.(audio, 'grok-stt', 'k')).rejects.toThrow(/text/i);
    });
});
