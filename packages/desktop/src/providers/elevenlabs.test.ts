// @vitest-environment node
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { elevenlabsConfig as cfg } from './elevenlabs';

describe('elevenlabs provider config', () => {
    it('has the required identity fields', () => {
        expect(cfg.id).toBe('elevenlabs');
        expect(cfg.name).toBe('ElevenLabs');
        expect(cfg.docsUrl).toMatch(/^https:\/\//);
    });

    it('has at least one default model', () => {
        expect(cfg.defaultModels.length).toBeGreaterThan(0);
    });

    it('default model ids include scribe_v1', () => {
        const ids = cfg.defaultModels.map((m) => m.id);
        expect(ids).toContain('scribe_v1');
    });

    it('has pricing entries for every default model', () => {
        for (const m of cfg.defaultModels) {
            const entry = cfg.pricing[m.id];
            expect(entry).toBeDefined();
            expect(entry?.perMinuteUSD).toBeGreaterThan(0);
            // Pricing entries carry their own audit date — the rule is a
            // valid ISO date in YYYY-MM-DD, not a single shared value (v2
            // Realtime was added 2026-05-18; v1 was audited earlier).
            expect(entry?.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it('lists scribe_v2_realtime first so it becomes the default for new configs', () => {
        expect(cfg.defaultModels[0]?.id).toBe('scribe_v2_realtime');
        expect(cfg.defaultModels[0]?.mode).toBe('realtime');
    });

    it('exposes makeRealtimeModel since at least one model is realtime', () => {
        expect(cfg.makeRealtimeModel).toBeDefined();
    });
});

describe('elevenlabs listModels', () => {
    const server = setupServer(
        http.get('https://api.elevenlabs.io/v1/models', () =>
            HttpResponse.json([
                { model_id: 'scribe_v1', name: 'Scribe v1', can_do_transcribe: true },
                {
                    model_id: 'scribe_v1_experimental',
                    name: 'Scribe v1 Experimental',
                    can_do_transcribe: true,
                },
                {
                    model_id: 'eleven_multilingual_v2',
                    name: 'Multilingual v2',
                    can_do_transcribe: false,
                },
            ]),
        ),
    );

    beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    it('listModels filters to transcribe-capable entries', async () => {
        expect(cfg.listModels).not.toBeNull();
        const models = await cfg.listModels?.('el-test');
        const ids = models?.map((m) => m.id).sort();
        expect(ids).toEqual(['scribe_v1', 'scribe_v1_experimental']);
    });
});
