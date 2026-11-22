import { HotkeyInput } from '@/components/HotkeyInput';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
    DEFAULT_INSERTION_METHOD,
    type InsertionMethod,
    getInsertionMethod,
    getPasteLastHotkeyCombo,
    setInsertionMethod,
    setPasteLastHotkeyCombo,
} from '@/lib/db';
import { vox } from '@/lib/invoke';
import { usePlatform } from '@/lib/use-platform';
import { useEffect, useId, useState } from 'react';

const METHOD_HINT: Record<InsertionMethod, string> = {
    paste: 'Pastes the text exactly as transcribed. Your clipboard is borrowed for about a second, then put back.',
    type: 'Never touches your clipboard. The app you are typing into may apply its own autocorrect or formatting, and text with a line break or emoji is pasted instead.',
};

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

export function SettingsInsertion() {
    const methodId = useId();
    const pasteLastId = useId();
    const platform = usePlatform();
    // Linux has no clipboard-free typing path, so there is nothing to choose.
    const offersTyping = platform !== null && platform.os !== 'linux';
    const [method, setMethod] = useState<InsertionMethod>(DEFAULT_INSERTION_METHOD);
    const [methodLoaded, setMethodLoaded] = useState(false);
    const [methodError, setMethodError] = useState<string | null>(null);
    const [pasteLast, setPasteLast] = useState<string | null>(null);
    const [pasteLastLoaded, setPasteLastLoaded] = useState(false);
    const [pasteLastError, setPasteLastError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void getInsertionMethod()
            .then((value) => {
                if (cancelled) return;
                setMethod(value);
                setMethodLoaded(true);
            })
            .catch(() => {
                if (!cancelled)
                    setMethodError('Could not load this setting. Reopen Settings to retry.');
            });
        void getPasteLastHotkeyCombo()
            .then((value) => {
                if (cancelled) return;
                setPasteLast(value);
                setPasteLastLoaded(true);
            })
            .catch(() => {
                if (!cancelled)
                    setPasteLastError('Could not load the shortcut. Reopen Settings to retry.');
            });
        return () => {
            cancelled = true;
        };
    }, []);

    async function changeMethod(next: InsertionMethod) {
        setMethodError(null);
        try {
            await setInsertionMethod(next);
            setMethod(next);
        } catch {
            setMethodError('Could not save this setting. Please try again.');
        }
    }

    async function changePasteLast(combo: string) {
        setPasteLastError(null);
        try {
            // Register first: a combo the OS refuses must not be saved.
            await vox.registerPasteLastHotkey(combo);
        } catch (e) {
            setPasteLastError(errorText(e));
            await restorePasteLast();
            return;
        }
        try {
            await setPasteLastHotkeyCombo(combo);
            setPasteLast(combo);
        } catch {
            setPasteLastError('Could not save the shortcut. Please try again.');
        }
    }

    async function clearPasteLast() {
        setPasteLastError(null);
        try {
            await vox.unregisterPasteLastHotkey();
            await setPasteLastHotkeyCombo(null);
            setPasteLast(null);
        } catch (e) {
            setPasteLastError(errorText(e));
        }
    }

    async function releasePasteLast() {
        // Free the OS-level shortcut so the webview can see the keys the user
        // is about to press.
        try {
            await vox.unregisterPasteLastHotkey();
        } catch (e) {
            console.error('unregister_paste_last_hotkey failed', e);
        }
    }

    async function restorePasteLast() {
        if (!pasteLast) return;
        try {
            await vox.registerPasteLastHotkey(pasteLast);
        } catch (e) {
            console.error('restoring the paste-last hotkey failed', e);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Text insertion</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm font-medium normal-case">
                {offersTyping && (
                    <div className="flex flex-col gap-1">
                        <Label htmlFor={methodId}>Insert transcripts by</Label>
                        <Select
                            id={methodId}
                            aria-describedby={`${methodId}-hint`}
                            value={method}
                            disabled={!methodLoaded}
                            onChange={(e) => void changeMethod(e.target.value as InsertionMethod)}
                        >
                            <option value="paste">Pasting, then restoring the clipboard</option>
                            <option value="type">Typing, without the clipboard</option>
                        </Select>
                        <p id={`${methodId}-hint`} className="text-xs text-muted-foreground">
                            {METHOD_HINT[method]}
                        </p>
                        {methodError && (
                            <p role="alert" className="text-xs text-red-700">
                                {methodError}
                            </p>
                        )}
                    </div>
                )}
                <div className="flex flex-col gap-1">
                    <Label htmlFor={pasteLastId}>Paste last transcription</Label>
                    <div id={pasteLastId} className="flex flex-wrap items-start gap-2">
                        <HotkeyInput
                            value={pasteLast ?? 'Not set'}
                            onChange={(combo) => void changePasteLast(combo)}
                            onCaptureStart={() => void releasePasteLast()}
                            onCaptureCancel={() => void restorePasteLast()}
                            allowFn={false}
                            allowChord={false}
                        />
                        <Button
                            variant="outline"
                            disabled={!pasteLastLoaded || pasteLast === null}
                            onClick={() => void clearPasteLast()}
                        >
                            Clear
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Optional. Press this shortcut anywhere to insert your most recent
                        transcription again at the cursor.
                    </p>
                    {pasteLastError && (
                        <p role="alert" className="text-xs text-red-700">
                            {pasteLastError}
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
