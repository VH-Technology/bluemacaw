import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toast } from '@/components/ui/toast';
import { useHotkeyRecording } from '@/hooks/useHotkeyRecording';
import { useUpdater } from '@/hooks/useUpdater';
import { listTranscriptions, restoreTranscription, softDeleteTranscription } from '@/lib/db';
import { useOnboardingGate } from '@/lib/use-onboarding-gate';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-shell';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dashboard } from './Dashboard';
import { History, type HistoryEntry } from './History';
import { OnboardingScreen } from './OnboardingScreen';
import { RecordingStatusPill } from './RecordingStatusPill';
import { SettingsApiKeys } from './SettingsApiKeys';
import { SettingsHistory } from './SettingsHistory';
import { SettingsModelConfigs } from './SettingsModelConfigs';
import { SettingsOverlay } from './SettingsOverlay';
import { SettingsRecording } from './SettingsRecording';
import { SettingsTheme } from './SettingsTheme';
import { SettingsUpdates } from './SettingsUpdates';
import { UpdateBanner } from './UpdateBanner';

function formatCreatedAt(ms: number): string {
    return new Date(ms).toISOString();
}

interface UndoToastState {
    open: boolean;
    rowId: number | null;
}

/**
 * Outer gate — routes the user through onboarding the first time they
 * launch bluemacaw on a machine where required permissions are missing,
 * silently bypasses it on every subsequent launch (and on Windows/Linux
 * where everything is usually already granted).
 */
export function MainWindow() {
    const { state, complete } = useOnboardingGate();
    if (state === 'loading') {
        return (
            <main
                className="flex min-h-screen items-center justify-center bg-bg text-fg"
                data-testid="main-loading"
            >
                <p className="text-sm font-medium">Loading…</p>
            </main>
        );
    }
    if (state === 'show-onboarding') {
        return <OnboardingScreen onComplete={complete} />;
    }
    return <MainWindowInner />;
}

/**
 * The original main-window UI — tabs, dashboard, history, settings. Split
 * out from [`MainWindow`] so the gate above can render an alternate tree
 * without running this component's hooks (which would otherwise issue
 * `listTranscriptions` etc. while the user is still on the onboarding
 * screen).
 */
export function MainWindowInner() {
    const { state: recordingState } = useHotkeyRecording();
    const { status: updaterStatus, checkForUpdates, installAndRestart } = useUpdater();
    const [historyEntries, setHistoryEntries] = useState<readonly HistoryEntry[]>([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const [undoToast, setUndoToast] = useState<UndoToastState>({ open: false, rowId: null });
    // Update-check failures are transient (often a cold-boot network blip), so
    // we surface them as an auto-dismissing toast rather than a banner that
    // lingers on the Dashboard until the user notices it.
    const [updateErrorToast, setUpdateErrorToast] = useState<string | null>(null);
    // Controlled so the update banner can be shown on the Dashboard only —
    // the Settings tab surfaces updates via its own Install & restart button.
    const [activeTab, setActiveTab] = useState('dashboard');
    const [appVersion, setAppVersion] = useState<string | null>(null);

    // Silent background check once on mount. Failures here are non-fatal —
    // the user can still trigger a manual check from Settings → Updates.
    useEffect(() => {
        void checkForUpdates();
    }, [checkForUpdates]);

    // Surface any update-check/install failure as a toast. updaterStatus only
    // changes identity on a real transition, so this fires once per failure.
    useEffect(() => {
        if (updaterStatus.kind === 'error') {
            setUpdateErrorToast(updaterStatus.message);
        }
    }, [updaterStatus]);

    // Pull the running binary's version (not the JS bundle's package.json) so
    // the footer reflects what's actually installed.
    useEffect(() => {
        void getVersion()
            .then(setAppVersion)
            .catch(() => setAppVersion(null));
    }, []);

    const loadHistory = useCallback(async () => {
        try {
            const rows = await listTranscriptions({ limit: 200 });
            setHistoryEntries(
                rows.map((r) => ({
                    id: String(r.id),
                    text: r.text,
                    provider: r.providerId,
                    model: r.modelId,
                    createdAt: formatCreatedAt(r.createdAt),
                    durationMs: r.durationMs,
                    wordCount: r.wordCount,
                })),
            );
        } catch (e) {
            console.error('listTranscriptions failed', e);
        }
    }, []);

    // Load history once on mount.
    useEffect(() => {
        void loadHistory();
    }, [loadHistory]);

    // Reload history + bump stats refresh key only on the edge where the
    // recording state transitions back to idle (e.g. transcribing -> idle
    // or error -> idle), not on every render where kind happens to be idle.
    const prevKindRef = useRef(recordingState.kind);
    useEffect(() => {
        const prev = prevKindRef.current;
        prevKindRef.current = recordingState.kind;
        if (prev !== 'idle' && recordingState.kind === 'idle') {
            void loadHistory();
            setRefreshKey((k) => k + 1);
        }
    }, [recordingState.kind, loadHistory]);

    async function handleDelete(rowId: string) {
        const id = Number(rowId);
        if (!Number.isFinite(id)) return;
        await softDeleteTranscription(id);
        await loadHistory();
        setUndoToast({ open: true, rowId: id });
    }

    async function handleUndo() {
        if (undoToast.rowId == null) return;
        await restoreTranscription(undoToast.rowId);
        setUndoToast({ open: false, rowId: null });
        await loadHistory();
    }

    // Fired by SettingsHistory after Clear all / retention purge so the
    // dashboard stats and history list refresh in-place instead of
    // requiring an app relaunch.
    const handleHistoryChanged = useCallback(() => {
        void loadHistory();
        setRefreshKey((k) => k + 1);
    }, [loadHistory]);

    return (
        <main className="min-h-screen bg-bg p-6 text-fg">
            {activeTab === 'dashboard' && (
                <UpdateBanner status={updaterStatus} onInstall={() => void installAndRestart()} />
            )}
            <header className="mb-6 flex flex-row items-start justify-between gap-4">
                <div className="flex flex-row items-center gap-3">
                    <img src="/logo.svg" alt="" className="h-12 w-12" />
                    <div>
                        <h1 className="text-3xl font-extrabold uppercase tracking-tight">
                            bluemacaw
                        </h1>
                        <p className="text-sm font-medium">Multi-provider speech-to-text.</p>
                    </div>
                </div>
                <div className="flex flex-row items-center gap-4">
                    <button
                        type="button"
                        onClick={() => open('https://github.com/VH-Technology/bluemacaw')}
                        data-testid="github-star-link"
                        className="flex items-center gap-2 rounded-pill px-3 py-1.5 text-xs font-extrabold uppercase tracking-widest text-fg transition-colors hover:bg-muted dark:text-white"
                    >
                        <svg
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            className="h-4 w-4"
                            aria-hidden="true"
                        >
                            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                        </svg>
                        Star us on GitHub
                    </button>
                    <RecordingStatusPill state={recordingState} />
                </div>
            </header>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList>
                    <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                <TabsContent
                    value="dashboard"
                    data-testid="panel-dashboard"
                    className="mt-8 flex flex-col gap-10"
                >
                    <section className="flex flex-col gap-4" data-testid="section-stats">
                        <Dashboard refreshKey={refreshKey} />
                    </section>
                    <section className="flex flex-col gap-4" data-testid="section-history">
                        <div className="flex flex-col gap-1">
                            <h2 className="text-2xl font-black tracking-tight text-brand-navy dark:text-fg">
                                Recent transcriptions
                            </h2>
                        </div>
                        <History
                            entries={historyEntries}
                            onDelete={handleDelete}
                            onExportFiltered={() => {}}
                        />
                    </section>
                </TabsContent>
                <TabsContent
                    value="settings"
                    data-testid="panel-settings"
                    className="flex flex-col gap-6"
                >
                    <SettingsApiKeys />
                    <SettingsModelConfigs />
                    <SettingsRecording />
                    <SettingsOverlay />
                    <SettingsHistory onHistoryChanged={handleHistoryChanged} />
                    <SettingsTheme />
                    <SettingsUpdates
                        status={updaterStatus}
                        onCheckNow={() => void checkForUpdates()}
                        onInstall={() => void installAndRestart()}
                    />
                    {appVersion && (
                        <p
                            className="mt-2 text-center text-xs text-muted-foreground"
                            data-testid="app-version"
                        >
                            Version {appVersion}
                        </p>
                    )}
                </TabsContent>
            </Tabs>
            <Toast
                open={undoToast.open}
                message="Transcription deleted."
                duration={5000}
                onClose={() => setUndoToast({ open: false, rowId: null })}
            />
            <Toast
                open={updateErrorToast !== null}
                variant="error"
                testId="update-error-toast"
                message={updateErrorToast ? `Update check failed: ${updateErrorToast}` : ''}
                duration={6000}
                onClose={() => setUpdateErrorToast(null)}
            />
            {undoToast.open && (
                <div className="fixed top-20 right-6 z-50">
                    <Button size="sm" variant="outline" onClick={() => void handleUndo()}>
                        Undo
                    </Button>
                </div>
            )}
        </main>
    );
}
