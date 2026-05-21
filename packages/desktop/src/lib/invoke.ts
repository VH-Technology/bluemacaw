import { invoke } from '@tauri-apps/api/core';
import { type UnlistenFn, listen } from '@tauri-apps/api/event';
import { EVT_AUDIO_CHUNK } from './markers';

/**
 * Payload emitted by the Rust `start_recording_realtime` pipeline for each
 * resampled chunk of audio. `samples` arrives as a JSON array of i16 values
 * over IPC — wrap with `new Int16Array(samples)` before pushing to a
 * provider WebSocket. `sampleRate` is always 16 000 (see `Resampler` in
 * `src-tauri/src/audio/resampler.rs`); included on every event so the JS
 * side never has to assume.
 */
export interface AudioChunkEvent {
    sessionId: string;
    samples: number[];
    sampleRate: number;
}

export type PermissionState = 'Granted' | 'Denied' | 'NotDetermined';

export interface AudioDeviceInfo {
    id: string;
    label: string;
    isDefault: boolean;
}

export type HostOs = 'macos' | 'windows' | 'linux';

/**
 * Platform context surfaced by the Rust `get_platform_info` command. The
 * webview keys per-OS behaviour off this value (e.g. which permission
 * rows the onboarding screen renders, whether to show the Wayland
 * paste-fallback banner). `isWayland` is always `false` on macOS/Windows.
 */
export interface PlatformInfo {
    os: HostOs;
    isWayland: boolean;
}

export const vox = {
    checkMicrophonePermission: () => invoke<PermissionState>('check_microphone_permission'),
    requestMicrophonePermission: () => invoke<PermissionState>('request_microphone_permission'),
    checkAccessibilityPermission: () => invoke<PermissionState>('check_accessibility_permission'),
    /**
     * Same as `checkAccessibilityPermission` but uses `prompt:true` so the
     * first call when the process isn't trusted shows the native macOS
     * "Open System Settings" dialog. Use on explicit user gesture (e.g. a
     * "Grant Accessibility" button); use the non-prompting variant for
     * passive status polling so the user doesn't get spammed with dialogs.
     */
    checkAccessibilityPermissionPrompting: () =>
        invoke<PermissionState>('check_accessibility_permission_prompting'),
    requestAccessibilityPermission: () => invoke<void>('request_accessibility_permission'),
    /**
     * Input Monitoring status — the macOS TCC bucket
     * (`kTCCServiceListenEvent`) that gates `CGEventTap`. This is what the
     * Fn-key shortcut needs; Accessibility (which gates `CGEventPost`,
     * i.e. paste) is a different permission.
     */
    checkInputMonitoringPermission: () =>
        invoke<PermissionState>('check_input_monitoring_permission'),
    /**
     * Kick off the Input Monitoring authorization flow. The OS dialog
     * appears asynchronously and the grant only takes effect after the
     * user quits and reopens the app (TCC does not propagate to a
     * running process).
     */
    requestInputMonitoringPermission: () =>
        invoke<PermissionState>('request_input_monitoring_permission'),
    openSettingsPanel: (panel: 'microphone' | 'accessibility' | 'input-monitoring') =>
        invoke<void>('open_settings_panel', { panel }),

    listAudioInputDevices: () => invoke<AudioDeviceInfo[]>('list_audio_input_devices'),
    startRecording: (deviceId?: string) => invoke<string>('start_recording', { deviceId }),
    /**
     * Realtime variant of `startRecording`. The audio source still buffers
     * a full WAV (returned by `stopRecording`), AND emits `EVT_AUDIO_CHUNK`
     * Tauri events with 16 kHz mono i16 PCM chunks as recording progresses.
     * Subscribe with `listenAudioChunks` to feed a provider WebSocket.
     */
    startRecordingRealtime: (deviceId?: string) =>
        invoke<string>('start_recording_realtime', { deviceId }),
    stopRecording: (sessionId: string) => invoke<number[]>('stop_recording', { sessionId }),
    /**
     * Abort an in-progress recording without producing audio. The Rust
     * side stops capture, drops the buffered samples, and removes the
     * session from its registry. No STT request is ever issued.
     */
    cancelRecording: (sessionId: string) => invoke<void>('cancel_recording', { sessionId }),
    /**
     * Read the loudest sample amplitude (0..1) observed since the previous
     * call. The Rust side resets the tracked peak on each read, so polling
     * this drives a real-time meter that decays naturally to zero.
     */
    getRecordingLevel: (sessionId: string) => invoke<number>('get_recording_level', { sessionId }),

    registerHotkey: (combo: string) => invoke<string>('register_hotkey', { combo }),
    unregisterHotkey: () => invoke<void>('unregister_hotkey'),
    /**
     * Register a global shortcut whose press cancels an in-progress
     * recording (via `EVT_SHORTCUT_CANCEL`). Independent of the toggle
     * hotkey — both registrations coexist. Combo parser still requires at
     * least one modifier so bare keys can't be swallowed system-wide.
     */
    registerCancelHotkey: (combo: string) => invoke<string>('register_cancel_hotkey', { combo }),
    unregisterCancelHotkey: () => invoke<void>('unregister_cancel_hotkey'),

    /** macOS only: read the AppleFnUsageType setting (0..3) or null if unset. */
    getFnUsageType: () => invoke<number | null>('get_fn_usage_type'),
    /** macOS only: write AppleFnUsageType + restart cfprefsd. */
    setFnUsageType: (value: number) => invoke<void>('set_fn_usage_type', { value }),

    getSecret: (secretId: string) => invoke<string | null>('get_secret', { secretId }),
    setSecret: (secretId: string, key: string) => invoke<void>('set_secret', { secretId, key }),
    deleteSecret: (secretId: string) => invoke<void>('delete_secret', { secretId }),

    pasteText: (text: string) => invoke<void>('paste_text', { text }),

    /**
     * Returns the current host OS and (on Linux) whether the session is
     * running under Wayland. Drives the onboarding screen's per-platform
     * permission row set and the Wayland paste-fallback info banner.
     */
    getPlatformInfo: () => invoke<PlatformInfo>('get_platform_info'),
    /**
     * Restart the running bluemacaw process. Used by the onboarding screen
     * after the user grants Accessibility / Input Monitoring on macOS,
     * since TCC doesn't propagate authorisation changes into a running
     * process.
     */
    restartApp: () => invoke<void>('restart_app'),
};

/**
 * Subscribe to audio chunks emitted during a realtime capture session.
 * Filters by `sessionId` so multiple subscribers — or stale listeners from
 * a previous session — never see each other's chunks. Returns an unlisten
 * function; call it on session end to release the Tauri event listener.
 */
export async function listenAudioChunks(
    sessionId: string,
    handler: (chunk: AudioChunkEvent) => void,
): Promise<UnlistenFn> {
    return listen<AudioChunkEvent>(EVT_AUDIO_CHUNK, (event) => {
        if (event.payload.sessionId === sessionId) {
            handler(event.payload);
        }
    });
}
