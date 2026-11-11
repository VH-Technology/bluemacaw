import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/invoke', () => ({
    vox: {
        getPlatformInfo: vi.fn(),
        checkMicrophonePermission: vi.fn(),
        checkAccessibilityPermission: vi.fn(),
        checkAccessibilityPermissionPrompting: vi.fn(),
        checkInputMonitoringPermission: vi.fn(),
        requestMicrophonePermission: vi.fn(),
        requestAccessibilityPermission: vi.fn(),
        requestInputMonitoringPermission: vi.fn(),
        openSettingsPanel: vi.fn(),
        restartApp: vi.fn(),
        registerHotkey: vi.fn(),
        unregisterHotkey: vi.fn(),
        registerCancelHotkey: vi.fn(),
        unregisterCancelHotkey: vi.fn(),
        validateCancelHotkey: vi.fn(),
        getFnUsageType: vi.fn(),
        setFnUsageType: vi.fn(),
    },
}));

vi.mock('@/lib/onboarding', () => ({
    markOnboardingCompleted: vi.fn(async () => undefined),
}));

vi.mock('@/lib/autostart', () => ({
    autostart: {
        isEnabled: vi.fn(async () => false),
        enable: vi.fn(async () => undefined),
        disable: vi.fn(async () => undefined),
        set: vi.fn(async () => undefined),
    },
}));

vi.mock('@/lib/db', () => ({
    getHotkeyCombo: vi.fn(async () => 'Cmd+Shift+Space'),
    setHotkeyCombo: vi.fn(async () => undefined),
    getCancelHotkeyCombo: vi.fn(async () => 'Cmd+Esc'),
    setCancelHotkeyCombo: vi.fn(async () => undefined),
    setHotkeysOnboarded: vi.fn(async () => undefined),
    getOriginalFnUsageType: vi.fn(async () => null),
    setOriginalFnUsageType: vi.fn(async () => undefined),
    clearOriginalFnUsageType: vi.fn(async () => undefined),
    listApiKeys: vi.fn(async () => []),
    addApiKey: vi.fn(async () => ({
        id: 'key-1',
        providerId: 'assemblyai',
        nickname: 'Personal',
        createdAt: '2026-05-15T00:00:00Z',
    })),
    addModelConfig: vi.fn(async () => ({
        id: 'mc-1',
        apiKeyId: 'key-1',
        modelId: 'best',
        providerId: 'assemblyai',
        apiKeyNickname: 'Personal',
    })),
}));

vi.mock('@/lib/onboarding-silent-skip', () => ({
    hasAllPermissionsSet: vi.fn(async () => false),
    hasHotkeysConfigured: vi.fn(async () => false),
    hasApiKeySet: vi.fn(async () => false),
    hasModelConfigSet: vi.fn(async () => false),
    hasLocalModelSet: vi.fn(async () => false),
}));

vi.mock('@/lib/use-platform', () => ({
    usePlatform: () => ({ os: 'macos', isWayland: false }),
    getPlatform: vi.fn(async () => ({ os: 'macos', isWayland: false })),
}));

import * as db from '@/lib/db';
import { vox } from '@/lib/invoke';
import { markOnboardingCompleted } from '@/lib/onboarding';
import {
    hasAllPermissionsSet,
    hasApiKeySet,
    hasHotkeysConfigured,
    hasLocalModelSet,
    hasModelConfigSet,
} from '@/lib/onboarding-silent-skip';
import { OnboardingScreen } from './OnboardingScreen';

function resetAllMocks() {
    vi.mocked(vox.getPlatformInfo).mockReset();
    vi.mocked(vox.checkMicrophonePermission).mockReset();
    vi.mocked(vox.checkAccessibilityPermission).mockReset();
    vi.mocked(vox.checkAccessibilityPermissionPrompting).mockReset();
    vi.mocked(vox.checkInputMonitoringPermission).mockReset();
    vi.mocked(vox.requestMicrophonePermission).mockReset();
    vi.mocked(vox.requestAccessibilityPermission).mockReset();
    vi.mocked(vox.requestInputMonitoringPermission).mockReset();
    vi.mocked(vox.openSettingsPanel).mockReset();
    vi.mocked(vox.restartApp).mockReset();
    vi.mocked(vox.registerHotkey).mockReset();
    vi.mocked(vox.unregisterHotkey).mockReset();
    vi.mocked(vox.registerCancelHotkey).mockReset();
    vi.mocked(vox.unregisterCancelHotkey).mockReset();
    vi.mocked(vox.validateCancelHotkey).mockReset();
    vi.mocked(vox.registerHotkey).mockResolvedValue('Cmd+Shift+Space');
    vi.mocked(vox.registerCancelHotkey).mockResolvedValue('Escape');
    vi.mocked(vox.validateCancelHotkey).mockResolvedValue('Escape');
    vi.mocked(db.getHotkeyCombo).mockReset();
    vi.mocked(db.getHotkeyCombo).mockResolvedValue('Cmd+Shift+Space');
    vi.mocked(db.setHotkeyCombo).mockReset();
    vi.mocked(db.setHotkeyCombo).mockResolvedValue(undefined);
    vi.mocked(db.getCancelHotkeyCombo).mockReset();
    vi.mocked(db.getCancelHotkeyCombo).mockResolvedValue('Escape');
    vi.mocked(db.setCancelHotkeyCombo).mockReset();
    vi.mocked(db.setCancelHotkeyCombo).mockResolvedValue(undefined);
    vi.mocked(db.setHotkeysOnboarded).mockReset();
    vi.mocked(db.setHotkeysOnboarded).mockResolvedValue(undefined);
    vi.mocked(db.listApiKeys).mockReset();
    vi.mocked(db.listApiKeys).mockResolvedValue([]);
    vi.mocked(db.addApiKey).mockReset();
    vi.mocked(db.addApiKey).mockResolvedValue({
        id: 'key-1',
        providerId: 'assemblyai',
        nickname: 'Personal',
        createdAt: '2026-05-15T00:00:00Z',
    });
    vi.mocked(db.addModelConfig).mockReset();
    vi.mocked(db.addModelConfig).mockResolvedValue({
        id: 'mc-1',
        apiKeyId: 'key-1',
        modelId: 'best',
        providerId: 'assemblyai',
        apiKeyNickname: 'Personal',
    });
    vi.mocked(markOnboardingCompleted).mockReset();
    vi.mocked(markOnboardingCompleted).mockResolvedValue(undefined);
    vi.mocked(hasAllPermissionsSet).mockReset();
    vi.mocked(hasHotkeysConfigured).mockReset();
    vi.mocked(hasApiKeySet).mockReset();
    vi.mocked(hasLocalModelSet).mockReset();
    vi.mocked(hasModelConfigSet).mockReset();
}

/** Set the predicate mocks; defaults to "nothing satisfied" so the
 * wizard walks the full sequence from step 1. */
function mockPredicates(
    p: Partial<{
        permissions: boolean;
        hotkeys: boolean;
        apiKey: boolean;
        modelConfig: boolean;
        localModel: boolean;
    }> = {},
) {
    vi.mocked(hasAllPermissionsSet).mockResolvedValue(p.permissions ?? false);
    vi.mocked(hasHotkeysConfigured).mockResolvedValue(p.hotkeys ?? false);
    vi.mocked(hasApiKeySet).mockResolvedValue(p.apiKey ?? false);
    vi.mocked(hasModelConfigSet).mockResolvedValue(p.modelConfig ?? false);
    vi.mocked(hasLocalModelSet).mockResolvedValue(p.localModel ?? false);
}

function mockAllPermissionsGranted(os: 'macos' | 'windows' | 'linux' = 'macos') {
    vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os, isWayland: false });
    vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');
    vi.mocked(vox.checkAccessibilityPermission).mockResolvedValue('Granted');
    vi.mocked(vox.checkInputMonitoringPermission).mockResolvedValue('Granted');
}

beforeEach(() => {
    resetAllMocks();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('<OnboardingScreen /> — step 1 (permissions)', () => {
    it('macOS: shows three permission rows and Next is disabled until all granted', async () => {
        mockPredicates();
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'macos', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');
        vi.mocked(vox.checkAccessibilityPermission).mockResolvedValue('Denied');
        vi.mocked(vox.checkInputMonitoringPermission).mockResolvedValue('Granted');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-row-microphone')).toBeInTheDocument());
        expect(screen.getByTestId('perm-row-accessibility')).toBeInTheDocument();
        expect(screen.getByTestId('perm-row-input-monitoring')).toBeInTheDocument();
        expect(screen.getByTestId('perm-continue')).toBeDisabled();
    });

    it('Windows: shows only the microphone row and Next enables when granted', async () => {
        mockPredicates();
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'windows', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-row-microphone')).toBeInTheDocument());
        expect(screen.queryByTestId('perm-row-accessibility')).toBeNull();
        expect(screen.queryByTestId('perm-row-input-monitoring')).toBeNull();
        await waitFor(() => expect(screen.getByTestId('perm-continue')).toBeEnabled());
    });

    it('Linux Wayland: shows the microphone row plus the Wayland info banner', async () => {
        mockPredicates();
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'linux', isWayland: true });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-row-microphone')).toBeInTheDocument());
        expect(screen.getByTestId('wayland-banner')).toBeInTheDocument();
    });

    it('Restart click calls restartApp without marking onboarding completed', async () => {
        mockPredicates();
        const user = userEvent.setup();
        const onComplete = vi.fn();
        vi.mocked(vox.getPlatformInfo).mockResolvedValue({ os: 'macos', isWayland: false });
        vi.mocked(vox.checkMicrophonePermission).mockResolvedValue('Granted');
        vi.mocked(vox.checkAccessibilityPermission).mockResolvedValue('Denied');
        vi.mocked(vox.checkInputMonitoringPermission).mockResolvedValue('Granted');
        vi.mocked(vox.checkAccessibilityPermissionPrompting).mockResolvedValue('Denied');
        vi.mocked(vox.openSettingsPanel).mockResolvedValue(undefined);

        render(<OnboardingScreen onComplete={onComplete} />);

        await waitFor(() =>
            expect(screen.getByTestId('perm-grant-accessibility')).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId('perm-grant-accessibility'));
        await waitFor(() => expect(screen.getByTestId('perm-restart')).toBeInTheDocument());
        await user.click(screen.getByTestId('perm-restart'));
        await waitFor(() => expect(vox.restartApp).toHaveBeenCalled());
        expect(markOnboardingCompleted).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
    });
});

describe('<OnboardingScreen /> — wizard navigation (full flow)', () => {
    it('Step 1 → 2: clicking Next when all granted advances to the hotkeys step', async () => {
        mockPredicates();
        const user = userEvent.setup();
        mockAllPermissionsGranted('windows');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-continue')).toBeEnabled());
        await user.click(screen.getByTestId('perm-continue'));
        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-hotkeys')).toBeInTheDocument(),
        );
    });

    it('Step 2 Back → 1: returns to the Permissions step even when permissions are already granted', async () => {
        mockPredicates();
        const user = userEvent.setup();
        mockAllPermissionsGranted('windows');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-continue')).toBeEnabled());
        await user.click(screen.getByTestId('perm-continue'));
        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-hotkeys')).toBeInTheDocument(),
        );
        const back = screen.getByTestId('hotkeys-back');
        await user.click(back);
        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-permissions')).toBeInTheDocument(),
        );
    });

    it('Step 2 → 3a: Next persists + registers both hotkeys, writes hotkeys_onboarded, and advances to model source', async () => {
        mockPredicates();
        const user = userEvent.setup();
        mockAllPermissionsGranted('windows');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-continue')).toBeEnabled());
        await user.click(screen.getByTestId('perm-continue'));
        await waitFor(() => expect(screen.getByTestId('hotkeys-next')).toBeEnabled());
        await user.click(screen.getByTestId('hotkeys-next'));

        await waitFor(() => expect(db.setHotkeyCombo).toHaveBeenCalledWith('Cmd+Shift+Space'));
        expect(vox.registerHotkey).toHaveBeenCalledWith('Cmd+Shift+Space');
        expect(db.setCancelHotkeyCombo).toHaveBeenCalledWith('Escape');
        expect(vox.validateCancelHotkey).toHaveBeenCalledWith('Escape');
        expect(vox.registerCancelHotkey).not.toHaveBeenCalled();
        expect(db.setHotkeysOnboarded).toHaveBeenCalledWith(true);

        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-choose-model-source')).toBeInTheDocument(),
        );
    });

    it('Step 3a "I\'ll do it later" marks completion and finishes without inserting a model config', async () => {
        mockPredicates();
        const user = userEvent.setup();
        const onComplete = vi.fn();
        mockAllPermissionsGranted('windows');

        render(<OnboardingScreen onComplete={onComplete} />);

        await waitFor(() => expect(screen.getByTestId('perm-continue')).toBeEnabled());
        await user.click(screen.getByTestId('perm-continue'));
        await waitFor(() => expect(screen.getByTestId('hotkeys-next')).toBeEnabled());
        await user.click(screen.getByTestId('hotkeys-next'));
        await waitFor(() => expect(screen.getByTestId('choose-source-skip')).toBeInTheDocument());
        await user.click(screen.getByTestId('choose-source-skip'));

        await waitFor(() => expect(markOnboardingCompleted).toHaveBeenCalledTimes(1));
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(db.addApiKey).not.toHaveBeenCalled();
        expect(db.addModelConfig).not.toHaveBeenCalled();
    });

    it('Step 3a choose cloud → 3b (API key), then → 3c (model picker)', async () => {
        mockPredicates();
        const user = userEvent.setup();
        mockAllPermissionsGranted('windows');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-continue')).toBeEnabled());
        await user.click(screen.getByTestId('perm-continue'));
        await waitFor(() => expect(screen.getByTestId('hotkeys-next')).toBeEnabled());
        await user.click(screen.getByTestId('hotkeys-next'));
        await waitFor(() => expect(screen.getByTestId('choose-cloud')).toBeInTheDocument());
        await user.click(screen.getByTestId('choose-cloud'));
        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-first-api-key')).toBeInTheDocument(),
        );
        await user.type(screen.getByTestId('onboarding-key-input'), 'sk-test');
        await user.click(screen.getByTestId('first-api-key-next'));

        await waitFor(() => expect(db.addApiKey).toHaveBeenCalledTimes(1));
        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-first-model')).toBeInTheDocument(),
        );
    });

    it('Step 3c Save & finish inserts model config and finishes', async () => {
        mockPredicates();
        const user = userEvent.setup();
        const onComplete = vi.fn();
        mockAllPermissionsGranted('windows');

        render(<OnboardingScreen onComplete={onComplete} />);

        await waitFor(() => expect(screen.getByTestId('perm-continue')).toBeEnabled());
        await user.click(screen.getByTestId('perm-continue'));
        await waitFor(() => expect(screen.getByTestId('hotkeys-next')).toBeEnabled());
        await user.click(screen.getByTestId('hotkeys-next'));
        await waitFor(() => expect(screen.getByTestId('choose-cloud')).toBeInTheDocument());
        await user.click(screen.getByTestId('choose-cloud'));
        await waitFor(() => expect(screen.getByTestId('onboarding-key-input')).toBeInTheDocument());
        await user.type(screen.getByTestId('onboarding-key-input'), 'sk-test');
        await user.click(screen.getByTestId('first-api-key-next'));
        await waitFor(() => expect(screen.getByTestId('first-model-finish')).toBeInTheDocument());
        await user.click(screen.getByTestId('first-model-finish'));

        await waitFor(() => expect(db.addModelConfig).toHaveBeenCalledTimes(1));
        const args = vi.mocked(db.addModelConfig).mock.calls[0]?.[0];
        expect(args?.apiKeyId).toBe('key-1');
        expect(markOnboardingCompleted).toHaveBeenCalledTimes(1);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('Step 3a choose local → 3b (OnboardingStepLocalModel)', async () => {
        mockPredicates();
        const user = userEvent.setup();
        mockAllPermissionsGranted('windows');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-continue')).toBeEnabled());
        await user.click(screen.getByTestId('perm-continue'));
        await waitFor(() => expect(screen.getByTestId('hotkeys-next')).toBeEnabled());
        await user.click(screen.getByTestId('hotkeys-next'));
        await waitFor(() => expect(screen.getByTestId('choose-local')).toBeInTheDocument());
        await user.click(screen.getByTestId('choose-local'));

        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-local-model')).toBeInTheDocument(),
        );
    });
});

describe('<OnboardingScreen /> — predicate-driven step skipping', () => {
    it('mounts directly on step 3c (model picker) when only the model config is missing', async () => {
        mockPredicates({
            permissions: true,
            hotkeys: true,
            apiKey: true,
            modelConfig: false,
        });
        vi.mocked(db.listApiKeys).mockResolvedValue([
            {
                id: 'existing-key',
                providerId: 'assemblyai',
                nickname: 'Personal',
                createdAt: '2026-05-14T00:00:00Z',
            },
        ]);
        mockAllPermissionsGranted('macos');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-first-model')).toBeInTheDocument(),
        );
        expect(screen.getByTestId('first-model-back')).toBeInTheDocument();
    });

    it('Step 3c Back → 3b, then Next with empty form → back to 3c without adding a new key', async () => {
        const user = userEvent.setup();
        mockPredicates({
            permissions: true,
            hotkeys: true,
            apiKey: true,
            modelConfig: false,
        });
        vi.mocked(db.listApiKeys).mockResolvedValue([
            {
                id: 'existing-key',
                providerId: 'assemblyai',
                nickname: 'Personal',
                createdAt: '2026-05-14T00:00:00Z',
            },
        ]);
        mockAllPermissionsGranted('macos');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('first-model-back')).toBeInTheDocument());
        await user.click(screen.getByTestId('first-model-back'));
        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-first-api-key')).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId('first-api-key-next'));
        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-first-model')).toBeInTheDocument(),
        );
        expect(db.addApiKey).not.toHaveBeenCalled();
    });

    it('mounts directly on step 3a (choose model source) when model source + api key + model config are all missing, and exposes no Back button', async () => {
        mockPredicates({
            permissions: true,
            hotkeys: true,
            apiKey: false,
            modelConfig: false,
            localModel: false,
        });
        mockAllPermissionsGranted('macos');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-choose-model-source')).toBeInTheDocument(),
        );
        expect(screen.queryByTestId('first-api-key-back')).toBeNull();
    });

    it('skips steps 3a and 3b when an api key already exists but the model config is missing (3a/3b → 3c directly after step 2)', async () => {
        mockPredicates({
            permissions: false,
            hotkeys: false,
            apiKey: true,
            modelConfig: false,
        });
        mockAllPermissionsGranted('windows');
        vi.mocked(db.listApiKeys).mockResolvedValue([
            {
                id: 'existing-key',
                providerId: 'assemblyai',
                nickname: 'Personal',
                createdAt: '2026-05-14T00:00:00Z',
            },
        ]);

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-continue')).toBeEnabled());
        await user(userEvent.setup()).click(screen.getByTestId('perm-continue'));
        await waitFor(() => expect(screen.getByTestId('hotkeys-next')).toBeEnabled());
        await user(userEvent.setup()).click(screen.getByTestId('hotkeys-next'));
        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-first-model')).toBeInTheDocument(),
        );
        expect(screen.queryByTestId('onboarding-step-choose-model-source')).toBeNull();
        expect(screen.queryByTestId('onboarding-step-first-api-key')).toBeNull();
        expect(db.addApiKey).not.toHaveBeenCalled();
    });

    it('skips steps 3a and 3b when a local model is already set (3a/3b → complete after step 2)', async () => {
        mockPredicates({
            permissions: false,
            hotkeys: false,
            apiKey: false,
            modelConfig: false,
            localModel: true,
        });
        mockAllPermissionsGranted('windows');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('perm-continue')).toBeEnabled());
        await user(userEvent.setup()).click(screen.getByTestId('perm-continue'));
        await waitFor(() => expect(screen.getByTestId('hotkeys-next')).toBeEnabled());
        await user(userEvent.setup()).click(screen.getByTestId('hotkeys-next'));
        // 3a satisfied (modelSource=true via localModel), 3b satisfied (localModel),
        // 3c satisfied (localModel=true) → finish
        await waitFor(() => expect(markOnboardingCompleted).toHaveBeenCalledTimes(1));
    });

    it('after manual Back from step 2, subsequent Next advances linearly (does not skip)', async () => {
        const user = userEvent.setup();
        mockPredicates({
            permissions: true,
            hotkeys: false,
            apiKey: true,
            modelConfig: true,
            localModel: false,
        });
        mockAllPermissionsGranted('macos');

        render(<OnboardingScreen onComplete={vi.fn()} />);

        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-hotkeys')).toBeInTheDocument(),
        );

        await user.click(screen.getByTestId('hotkeys-back'));
        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-permissions')).toBeInTheDocument(),
        );

        await waitFor(() => expect(screen.getByTestId('perm-continue')).toBeEnabled());
        await user.click(screen.getByTestId('perm-continue'));
        await waitFor(() =>
            expect(screen.getByTestId('onboarding-step-hotkeys')).toBeInTheDocument(),
        );
    });

    it('finishes immediately if every predicate flips to true between the gate and mount (defensive)', async () => {
        mockPredicates({
            permissions: true,
            hotkeys: true,
            apiKey: true,
            modelConfig: true,
            localModel: false,
        });
        const onComplete = vi.fn();

        render(<OnboardingScreen onComplete={onComplete} />);

        await waitFor(() => expect(markOnboardingCompleted).toHaveBeenCalledTimes(1));
        expect(onComplete).toHaveBeenCalledTimes(1);
    });
});

/** Sync helper so the test reads less awkwardly when reusing userEvent. */
function user(u: ReturnType<typeof userEvent.setup>) {
    return u;
}
