import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface TauriConfig {
    bundle?: {
        macOS?: {
            minimumSystemVersion?: string;
        };
    };
}

describe('release configuration', () => {
    it('targets macOS 10.15 or newer for whisper.cpp filesystem support', () => {
        const configPath = resolve(__dirname, '../../src-tauri/tauri.conf.json');
        const config = JSON.parse(readFileSync(configPath, 'utf8')) as TauriConfig;

        expect(config.bundle?.macOS?.minimumSystemVersion).toBe('10.15');
    });
});
