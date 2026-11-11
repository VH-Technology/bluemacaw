import { getHotkeysOnboarded, listApiKeys, listModelConfigs } from '@/lib/db';
import { type PermissionState, vox } from '@/lib/invoke';
import { type PermissionKey, requiredPermissions } from '@/lib/platform';

/**
 * Status check (non-prompting) for a given permission key. Mirrors the
 * dispatch in `useOnboardingStatus`, but as a one-shot probe — the gate
 * (and the wizard at mount time) run this exactly once.
 */
async function checkPermission(key: PermissionKey): Promise<PermissionState> {
    switch (key) {
        case 'microphone':
            return vox.checkMicrophonePermission();
        case 'accessibility':
            return vox.checkAccessibilityPermission();
        case 'input-monitoring':
            return vox.checkInputMonitoringPermission();
    }
}

/**
 * Per-step predicates. Each maps 1:1 to a wizard step:
 *
 * - `hasAllPermissionsSet` ↔ step 1 (Permissions)
 * - `hasHotkeysConfigured` ↔ step 2 (Hotkeys)
 * - `hasApiKeySet` ↔ sub-step 3a (First API key)
 * - `hasModelConfigSet` ↔ sub-step 3b (First model config)
 *
 * Both the gate (via `shouldSilentSkip`) and the wizard shell call these
 * to decide whether to skip a step. Keeping the checks in one place means
 * a future maintainer changing the wizard only has to touch this file.
 *
 * Every predicate swallows errors and returns `false` defensively — better
 * to show a redundant wizard than to silently route a half-configured user
 * into the main UI.
 */
export async function hasAllPermissionsSet(): Promise<boolean> {
    try {
        const info = await vox.getPlatformInfo();
        const req = requiredPermissions(info);
        if (req.required.length === 0) return true;
        const states = await Promise.all(req.required.map((k) => checkPermission(k)));
        return states.every((s) => s === 'Granted');
    } catch (e) {
        console.error('hasAllPermissionsSet: probe failed', e);
        return false;
    }
}

export async function hasHotkeysConfigured(): Promise<boolean> {
    try {
        return await getHotkeysOnboarded();
    } catch (e) {
        console.error('hasHotkeysConfigured: probe failed', e);
        return false;
    }
}

export async function hasApiKeySet(): Promise<boolean> {
    try {
        const keys = await listApiKeys();
        return keys.length > 0;
    } catch (e) {
        console.error('hasApiKeySet: probe failed', e);
        return false;
    }
}

export async function hasModelConfigSet(): Promise<boolean> {
    try {
        const configs = await listModelConfigs();
        return configs.length > 0;
    } catch (e) {
        console.error('hasModelConfigSet: probe failed', e);
        return false;
    }
}

export async function hasLocalModelSet(): Promise<boolean> {
    try {
        const { vox } = await import('@/lib/invoke');
        const models = await vox.listLocalModels();
        return models.length > 0;
    } catch (e) {
        console.error('hasLocalModelSet: probe failed', e);
        return false;
    }
}

/**
 * Returns `true` when every wizard step's requirement is already
 * satisfied — i.e. running the wizard end-to-end would be a no-op. The
 * gate uses this to silently mark onboarding complete and route straight
 * to the main UI on app launch.
 */
export async function shouldSilentSkip(): Promise<boolean> {
    const [perms, hotkeys, key, model, local] = await Promise.all([
        hasAllPermissionsSet(),
        hasHotkeysConfigured(),
        hasApiKeySet(),
        hasModelConfigSet(),
        hasLocalModelSet(),
    ]);
    return perms && hotkeys && (local || (key && model));
}
