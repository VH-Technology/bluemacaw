import { getCancelHotkeyCombo } from '@/lib/db';
import { vox } from '@/lib/invoke';
import { EVT_SHORTCUT_CANCEL, EVT_SHORTCUT_TOGGLE } from '@/lib/markers';
import { publishRecordingState } from '@/lib/overlay-bridge';
import {
    type RecordingDeps,
    type RecordingState,
    cancel,
    toggle,
} from '@/lib/recording-controller';
import { transcribe } from '@/lib/transcribe';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';

// Re-exported under the historical name so existing test imports keep working.
// The single source of truth lives in `@/lib/markers` — do not introduce a
// second copy of this string.
export const SHORTCUT_EVENT = EVT_SHORTCUT_TOGGLE;

const defaultDeps: RecordingDeps = { vox, transcribe };

export type PublishFn = (state: RecordingState) => Promise<void>;

export interface UseHotkeyRecordingOptions {
    /** Override deps in tests. */
    deps?: RecordingDeps;
    /** Override the bridge that broadcasts state to the overlay window. */
    publish?: PublishFn;
}

export function useHotkeyRecording(options: UseHotkeyRecordingOptions = {}): {
    state: RecordingState;
} {
    const [state, setState] = useState<RecordingState>({ kind: 'idle' });
    const stateRef = useRef(state);
    stateRef.current = state;

    const deps = options.deps ?? defaultDeps;
    const depsRef = useRef(deps);
    depsRef.current = deps;

    const publish = options.publish ?? publishRecordingState;
    const publishRef = useRef(publish);
    publishRef.current = publish;

    useEffect(() => {
        let cancelled = false;
        // Track whether the cancel hotkey is currently registered so the
        // recording-start path can be idempotent and the recording-end
        // path doesn't fire an unnecessary unregister IPC.
        let cancelHotkeyActive = false;

        async function registerCancelHotkey() {
            if (cancelHotkeyActive) return;
            try {
                const combo = await getCancelHotkeyCombo();
                await vox.registerCancelHotkey(combo);
                cancelHotkeyActive = true;
            } catch (e) {
                // A failed cancel-hotkey registration must never block
                // recording — the overlay's Cancel button still works.
                console.error('registerCancelHotkey failed', e);
            }
        }

        async function unregisterCancelHotkey() {
            if (!cancelHotkeyActive) return;
            try {
                await vox.unregisterCancelHotkey();
            } catch (e) {
                console.error('unregisterCancelHotkey failed', e);
            } finally {
                cancelHotkeyActive = false;
            }
        }

        const applyNext = (next: RecordingState) => {
            if (cancelled) return;
            setState(next);
            void publishRef.current(next);
            if (next.kind === 'recording') {
                void registerCancelHotkey();
            } else {
                void unregisterCancelHotkey();
            }
        };
        const togglePromise = listen(SHORTCUT_EVENT, () => {
            void toggle(stateRef.current, depsRef.current, applyNext);
        });
        const cancelPromise = listen(EVT_SHORTCUT_CANCEL, () => {
            void cancel(stateRef.current, depsRef.current, applyNext);
        });
        return () => {
            cancelled = true;
            void togglePromise.then((fn) => fn());
            void cancelPromise.then((fn) => fn());
            // Best-effort: drop any cancel-hotkey registration we still
            // own when the hook tears down (e.g. main window close).
            void unregisterCancelHotkey();
        };
    }, []);

    return { state };
}
