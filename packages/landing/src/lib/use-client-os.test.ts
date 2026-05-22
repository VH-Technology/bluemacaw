import { describe, expect, it } from 'vitest';
import { type ClientOS, detectOS, osMeta } from './use-client-os';

const UAS: Record<string, { ua: string; platform?: string; expected: ClientOS }> = {
    macIntel: {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
        platform: 'MacIntel',
        expected: 'macos',
    },
    macSilicon: {
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari',
        platform: 'MacIntel',
        expected: 'macos',
    },
    iphone: {
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        expected: 'macos',
    },
    windows: {
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        platform: 'Win32',
        expected: 'windows',
    },
    linux: {
        ua: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
        platform: 'Linux x86_64',
        expected: 'linux',
    },
    chromeos: {
        ua: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36',
        expected: 'linux',
    },
    garbage: { ua: 'some-random-bot/1.0', expected: 'unknown' },
};

describe('detectOS', () => {
    for (const [name, { ua, platform, expected }] of Object.entries(UAS)) {
        it(`classifies ${name} as ${expected}`, () => {
            expect(detectOS(ua, platform)).toBe(expected);
        });
    }
});

describe('osMeta', () => {
    it('returns ⌘ glyphs for macOS', () => {
        expect(osMeta('macos').shortcut).toEqual(['⌘', '⇧', 'Space']);
        expect(osMeta('macos').label).toBe('macOS');
        expect(osMeta('macos').manifestKey).toBe('mac');
    });

    it('returns Ctrl for Windows + Linux', () => {
        expect(osMeta('windows').shortcut).toEqual(['Ctrl', '⇧', 'Space']);
        expect(osMeta('linux').shortcut).toEqual(['Ctrl', '⇧', 'Space']);
        expect(osMeta('windows').manifestKey).toBe('win');
        expect(osMeta('linux').manifestKey).toBe('linux');
    });

    it('falls back to macOS glyphs for unknown', () => {
        expect(osMeta('unknown').shortcut).toEqual(['⌘', '⇧', 'Space']);
    });
});
