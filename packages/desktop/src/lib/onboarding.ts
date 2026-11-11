import { load } from '@tauri-apps/plugin-store';

/**
 * Filename for the onboarding-state store. Stored in `app_data_dir` per
 * Tauri's plugin-store convention. The `.bin` extension is the
 * plugin-store default (msgpack-encoded); kept short and namespaced under
 * the app's own data directory.
 *
 * Versioned key so a future onboarding redesign can introduce a new key
 * without colliding with existing user state. Bumped to `_v3` for the
 * model-source fork (cloud vs local); `_v2` was the 3-step wizard
 * (permissions + hotkeys + first provider); `_v1` was the original
 * single-screen flow. Older flags are intentionally ignored so legacy
 * users re-onboard through the latest walkthrough once.
 */
const STORE_PATH = 'bluemacaw-onboarding.bin';
const STORE_KEY = 'onboarding_v3_completed';

/**
 * Returns true if the user has previously completed (or skipped)
 * onboarding on this machine. The store auto-saves on modification — the
 * default debounce is 100ms.
 *
 * Returns `false` on first launch (key absent) and on any plugin-store
 * error — we'd rather show the onboarding screen redundantly than skip
 * it because a transient I/O blip swallowed the read.
 */
export async function isOnboardingCompleted(): Promise<boolean> {
    try {
        const store = await load(STORE_PATH);
        const value = await store.get<boolean>(STORE_KEY);
        return value === true;
    } catch (e) {
        console.error('isOnboardingCompleted: store load failed', e);
        return false;
    }
}

/**
 * Persists that the user completed (or explicitly skipped) onboarding.
 * Subsequent launches skip the onboarding screen and route straight to
 * the main UI.
 */
export async function markOnboardingCompleted(): Promise<void> {
    const store = await load(STORE_PATH);
    await store.set(STORE_KEY, true);
    await store.save();
}
