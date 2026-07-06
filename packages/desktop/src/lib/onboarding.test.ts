import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory mock of `@tauri-apps/plugin-store`. Persists between calls
 * within a single test so we can exercise the get/set round-trip without
 * touching the real Tauri runtime.
 */
const storeData: Map<string, unknown> = new Map();

vi.mock('@tauri-apps/plugin-store', () => ({
    load: vi.fn(async () => ({
        get: vi.fn(async (k: string) => storeData.get(k)),
        set: vi.fn(async (k: string, v: unknown) => {
            storeData.set(k, v);
        }),
        save: vi.fn(async () => undefined),
    })),
}));

import { isOnboardingCompleted, markOnboardingCompleted } from './onboarding';

beforeEach(() => {
    storeData.clear();
});

describe('onboarding store', () => {
    it('returns false when the flag has never been set', async () => {
        await expect(isOnboardingCompleted()).resolves.toBe(false);
    });

    it('persists completion via markOnboardingCompleted', async () => {
        await markOnboardingCompleted();
        await expect(isOnboardingCompleted()).resolves.toBe(true);
    });

    it('returns false on a store load error so onboarding is shown defensively', async () => {
        const { load } = await import('@tauri-apps/plugin-store');
        vi.mocked(load).mockRejectedValueOnce(new Error('disk full'));
        await expect(isOnboardingCompleted()).resolves.toBe(false);
    });

    it('reads/writes under the v3 key so legacy v1/v2 completion does not skip the new wizard', async () => {
        storeData.set('onboarding_v1_completed', true);
        await expect(isOnboardingCompleted()).resolves.toBe(false);
        await markOnboardingCompleted();
        expect(storeData.get('onboarding_v3_completed')).toBe(true);
    });
});
