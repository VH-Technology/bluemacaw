import {
    getHistoryLastSweep,
    getHotkeyCombo,
    getRetentionDays,
    purgeOlderThan,
    setHistoryLastSweep,
} from '@/lib/db';
import { vox } from '@/lib/invoke';
import { useEffect } from 'react';
import { MainWindow } from './windows/main/MainWindow';
import { OverlayApp } from './windows/overlay/OverlayApp';

export default function App() {
    const params = new URLSearchParams(window.location.search);
    const which = params.get('window') ?? 'main';
    const isMain = which !== 'overlay';

    useEffect(() => {
        if (!isMain) return;
        void (async () => {
            try {
                const combo = await getHotkeyCombo();
                await vox.registerHotkey(combo);
            } catch (e) {
                console.error('initial registerHotkey failed', e);
            }
        })();
        // The cancel hotkey is intentionally NOT registered here. Its
        // lifecycle is bound to the recording state (`useHotkeyRecording`):
        // registered on recording start, unregistered when recording ends.
        // That keeps bare-key bindings like Esc from being globally
        // swallowed outside the recording window.
    }, [isMain]);

    useEffect(() => {
        if (!isMain) return;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let cancelled = false;

        async function runSweep() {
            const days = await getRetentionDays();
            const last = await getHistoryLastSweep();
            const now = Date.now();
            const dayMs = 24 * 60 * 60 * 1000;
            if (last == null || now - last >= dayMs) {
                await purgeOlderThan(days);
                await setHistoryLastSweep(now);
            }
            if (cancelled) return;
            const nextDelay = Math.max(60_000, dayMs - (now - (last ?? now)));
            timer = setTimeout(() => void runSweep(), nextDelay);
        }

        void runSweep();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [isMain]);

    if (!isMain) {
        return <OverlayApp />;
    }
    return <MainWindow />;
}
