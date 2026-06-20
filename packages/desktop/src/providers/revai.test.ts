// @vitest-environment node
import { experimental_transcribe as transcribe } from 'ai';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { revaiConfig as cfg } from './revai';

describe('revai provider config', () => {
    it('has the required identity fields', () => {
        expect(cfg.id).toBe('revai');
        expect(cfg.name).toBe('Rev.ai');
        expect(cfg.docsUrl).toMatch(/^https:\/\//);
    });

    it('default models include machine and low_cost', () => {
        const ids = cfg.defaultModels.map((m) => m.id);
        expect(ids).toContain('machine');
        expect(ids).toContain('low_cost');
    });

    it('has pricing entries for every default model', () => {
        for (const m of cfg.defaultModels) {
            const entry = cfg.pricing[m.id];
            expect(entry).toBeDefined();
            expect(entry?.perMinuteUSD).toBeGreaterThan(0);
            // Entries carry their own audit date (low_cost was re-priced
            // 2026-06-20); require a valid ISO date, not one shared value.
            expect(entry?.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it('exposes low_cost as the Reverb Turbo tier with corrected pricing', () => {
        const turbo = cfg.defaultModels.find((m) => m.id === 'low_cost');
        expect(turbo?.displayName).toBe('Reverb Turbo');
        // Reverb Turbo is $0.10/hr ≈ $0.001667/min (was mis-recorded at $0.0167).
        expect(cfg.pricing.low_cost?.perMinuteUSD).toBeCloseTo(0.001667, 5);
    });

    it('listModels is null (Rev.ai uses hardcoded list)', () => {
        expect(cfg.listModels).toBeNull();
    });

    it('makeModel returns a model object', () => {
        const m = cfg.makeModel('machine', 'rev-test');
        expect(m).toBeDefined();
    });
});

describe('revai transcription HTTP', () => {
    const server = setupServer();

    beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);

    interface Captured {
        submitAuth: string | null;
        submitUrl: URL;
        pollAuth: string | null;
        transcriptAuth: string | null;
    }

    function setupHappyPath(): { captured: Captured } {
        const captured: Captured = {
            submitAuth: null,
            submitUrl: new URL('https://placeholder.invalid/'),
            pollAuth: null,
            transcriptAuth: null,
        };
        server.use(
            http.post('https://api.rev.ai/speechtotext/v1/jobs', ({ request }) => {
                captured.submitAuth = request.headers.get('authorization');
                captured.submitUrl = new URL(request.url);
                return HttpResponse.json({
                    id: 'rev-job-1',
                    status: 'in_progress',
                });
            }),
            http.get('https://api.rev.ai/speechtotext/v1/jobs/rev-job-1', ({ request }) => {
                captured.pollAuth = request.headers.get('authorization');
                return HttpResponse.json({
                    id: 'rev-job-1',
                    status: 'transcribed',
                    language: 'en',
                });
            }),
            http.get(
                'https://api.rev.ai/speechtotext/v1/jobs/rev-job-1/transcript',
                ({ request }) => {
                    captured.transcriptAuth = request.headers.get('authorization');
                    return HttpResponse.json({
                        monologues: [
                            {
                                elements: [
                                    {
                                        type: 'text',
                                        value: 'hello from rev',
                                        ts: 0,
                                        end_ts: 1.5,
                                    },
                                ],
                            },
                        ],
                    });
                },
            ),
        );
        return { captured };
    }

    it('submits a job, polls until transcribed, fetches transcript with Bearer auth', async () => {
        const { captured } = setupHappyPath();
        const model = cfg.makeModel('machine', 'rev-test-key');
        const result = await transcribe({ model, audio: fakeAudio, maxRetries: 0 });

        expect(result.text.trim()).toBe('hello from rev');
        expect(captured.submitAuth).toBe('Bearer rev-test-key');
        expect(captured.pollAuth).toBe('Bearer rev-test-key');
        expect(captured.transcriptAuth).toBe('Bearer rev-test-key');
        expect(captured.submitUrl.host).toBe('api.rev.ai');
        expect(captured.submitUrl.pathname).toBe('/speechtotext/v1/jobs');
    });

    it('propagates 401 unauthorized errors on submit', async () => {
        server.use(
            http.post('https://api.rev.ai/speechtotext/v1/jobs', () =>
                HttpResponse.json({ title: 'unauthorized' }, { status: 401 }),
            ),
        );
        const model = cfg.makeModel('machine', 'bad-key');
        await expect(transcribe({ model, audio: fakeAudio, maxRetries: 0 })).rejects.toThrow();
    });

    it('propagates 429 rate-limit errors on submit', async () => {
        server.use(
            http.post('https://api.rev.ai/speechtotext/v1/jobs', () =>
                HttpResponse.json({ title: 'rate limited' }, { status: 429 }),
            ),
        );
        const model = cfg.makeModel('machine', 'rev-test');
        await expect(transcribe({ model, audio: fakeAudio, maxRetries: 0 })).rejects.toThrow();
    });

    it('does not crash on a 500 with HTML body on submit', async () => {
        server.use(
            http.post('https://api.rev.ai/speechtotext/v1/jobs', () =>
                HttpResponse.html('<html>upstream error</html>', { status: 500 }),
            ),
        );
        const model = cfg.makeModel('machine', 'rev-test');
        await expect(transcribe({ model, audio: fakeAudio, maxRetries: 0 })).rejects.toThrow();
    });
});
