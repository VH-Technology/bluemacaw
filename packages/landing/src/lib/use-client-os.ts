'use client';

import { useEffect, useState } from 'react';

export type ClientOS = 'macos' | 'windows' | 'linux' | 'unknown';

/**
 * Pure OS sniff from a user-agent (and optional legacy platform) string.
 * Exported separately from the hook so it can be unit-tested without a DOM.
 * Order matters: iOS/iPadOS report "Mac" in some UAs, so we treat any
 * apple-family token as macOS for our purposes (the visitor is on an Apple
 * device; we surface the macOS build + ⌘ symbols).
 */
export function detectOS(userAgent: string, platform = ''): ClientOS {
    const s = `${userAgent} ${platform}`.toLowerCase();
    if (/mac|iphone|ipad|ipod/.test(s)) return 'macos';
    if (/win/.test(s)) return 'windows';
    if (/linux|x11|cros|android/.test(s)) return 'linux';
    return 'unknown';
}

/**
 * Resolve the visitor's OS on the client. The landing is a static export, so
 * detection must happen after hydration — we start at 'unknown' (matching the
 * server-rendered HTML) and update on mount, which avoids a hydration
 * mismatch. Components should render an OS-neutral fallback for 'unknown'.
 */
export function useClientOS(): ClientOS {
    const [os, setOS] = useState<ClientOS>('unknown');
    useEffect(() => {
        if (typeof navigator === 'undefined') return;
        setOS(detectOS(navigator.userAgent, navigator.platform));
    }, []);
    return os;
}

export interface OSMeta {
    /** Display label, e.g. "macOS". */
    label: string;
    /** Record-hotkey rendered as discrete key tokens. */
    shortcut: readonly string[];
    /** Which `DownloadManifest` field this OS maps to. */
    manifestKey: 'mac' | 'win' | 'linux';
}

// macOS uses the ⌘/⇧ glyphs; Windows + Linux share Ctrl+Shift+Space.
const MAC_META: OSMeta = { label: 'macOS', shortcut: ['⌘', '⇧', 'Space'], manifestKey: 'mac' };
const WIN_META: OSMeta = {
    label: 'Windows',
    shortcut: ['Ctrl', '⇧', 'Space'],
    manifestKey: 'win',
};
const LINUX_META: OSMeta = {
    label: 'Linux',
    shortcut: ['Ctrl', '⇧', 'Space'],
    manifestKey: 'linux',
};

const OS_META: Record<Exclude<ClientOS, 'unknown'>, OSMeta> = {
    macos: MAC_META,
    windows: WIN_META,
    linux: LINUX_META,
};

/**
 * Metadata for a detected OS. For 'unknown' we fall back to the macOS glyph
 * set (the most common visitor) but callers that care about the distinction
 * (e.g. the hero download button) should check `os === 'unknown'` and render
 * an OS-neutral label instead.
 */
export function osMeta(os: ClientOS): OSMeta {
    return os === 'unknown' ? MAC_META : OS_META[os];
}
