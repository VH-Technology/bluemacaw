import { vox } from '@/lib/invoke';
import { type Update, check } from '@tauri-apps/plugin-updater';
import { useCallback, useRef, useState } from 'react';

export type UpdaterStatus =
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'up-to-date' }
    | { kind: 'available'; version: string }
    | { kind: 'downloading'; progress: number }
    | { kind: 'installing' }
    | { kind: 'error'; message: string };

export interface UpdaterDeps {
    check: typeof check;
    restartApp: () => Promise<void>;
    /** Delay between backoff retries; injectable so tests skip real timers. */
    sleep: (ms: number) => Promise<void>;
}

const defaultDeps: UpdaterDeps = {
    check,
    restartApp: () => vox.restartApp(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface RetryConfig {
    /** Total attempts including the first (so 5 = 1 try + 4 retries). */
    attempts: number;
    /** Delay before the first retry; doubles each subsequent retry. */
    baseDelayMs: number;
    /** Upper bound for any single backoff delay. */
    maxDelayMs: number;
}

// Rides out the cold-boot window where the network isn't up yet when the app
// is launched at login: ~1s + 2s + 4s + 8s ≈ 15s of total backoff.
const DEFAULT_RETRY: RetryConfig = { attempts: 5, baseDelayMs: 1000, maxDelayMs: 8000 };

export interface UseUpdaterOptions {
    /** Override deps in tests. */
    deps?: UpdaterDeps;
    /** Override the backoff schedule (defaults to {@link DEFAULT_RETRY}). */
    retry?: Partial<RetryConfig>;
}

export interface UseUpdaterReturn {
    status: UpdaterStatus;
    checkForUpdates: () => Promise<void>;
    installAndRestart: () => Promise<void>;
}

export function useUpdater(options: UseUpdaterOptions = {}): UseUpdaterReturn {
    const deps = options.deps ?? defaultDeps;
    const attempts = options.retry?.attempts ?? DEFAULT_RETRY.attempts;
    const baseDelayMs = options.retry?.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs;
    const maxDelayMs = options.retry?.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;
    const [status, setStatus] = useState<UpdaterStatus>({ kind: 'idle' });
    // Hold the latest Update across callbacks without forcing re-renders or
    // depending on it in the install callback's closure.
    const updateRef = useRef<Update | null>(null);

    const checkForUpdates = useCallback(async () => {
        setStatus({ kind: 'checking' });
        // Retry with exponential backoff before surfacing an error. Network
        // access often isn't up yet when the app launches at login, so a
        // first-attempt failure is usually transient. We stay in 'checking'
        // across retries and only report 'error' once every attempt fails.
        let lastError: unknown;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const result = await deps.check();
                updateRef.current = result;
                setStatus(
                    result
                        ? { kind: 'available', version: result.version }
                        : { kind: 'up-to-date' },
                );
                return;
            } catch (e) {
                lastError = e;
                if (attempt < attempts) {
                    const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
                    await deps.sleep(delay);
                }
            }
        }
        setStatus({
            kind: 'error',
            message: lastError instanceof Error ? lastError.message : String(lastError),
        });
    }, [deps, attempts, baseDelayMs, maxDelayMs]);

    const installAndRestart = useCallback(async () => {
        const update = updateRef.current;
        if (!update) return;
        setStatus({ kind: 'downloading', progress: 0 });
        try {
            let contentLength = 0;
            let downloaded = 0;
            await update.downloadAndInstall((event) => {
                switch (event.event) {
                    case 'Started':
                        contentLength = event.data.contentLength ?? 0;
                        downloaded = 0;
                        break;
                    case 'Progress':
                        downloaded += event.data.chunkLength;
                        setStatus({
                            kind: 'downloading',
                            progress: contentLength > 0 ? downloaded / contentLength : 0,
                        });
                        break;
                    case 'Finished':
                        setStatus({ kind: 'installing' });
                        break;
                }
            });
            // On macOS/Linux `downloadAndInstall` returns after staging the
            // new binary; the running process must restart for the user to
            // see the new version. On Windows the installer typically exits
            // the app on its own, but calling restart is a harmless no-op
            // if the process is already gone.
            await deps.restartApp();
        } catch (e) {
            setStatus({
                kind: 'error',
                message: e instanceof Error ? e.message : String(e),
            });
        }
    }, [deps]);

    return { status, checkForUpdates, installAndRestart };
}
