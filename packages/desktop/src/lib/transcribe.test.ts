import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('ai', () => ({
    experimental_transcribe: vi.fn(async () => ({ text: 'hello world' })),
}));
vi.mock('./db', () => ({
    getActiveModelConfigId: vi.fn(),
    getModelConfigWithApiKey: vi.fn(),
}));

import * as core from '@tauri-apps/api/core';
import { PROVIDERS } from '../providers';
import * as db from './db';
import { transcribe } from './transcribe';

beforeEach(() => {
    vi.mocked(core.invoke).mockReset();
    vi.mocked(db.getActiveModelConfigId).mockReset();
    vi.mocked(db.getModelConfigWithApiKey).mockReset();
});

describe('transcribe orchestration', () => {
    it('throws when no model is selected', async () => {
        vi.mocked(db.getActiveModelConfigId).mockResolvedValueOnce(null);
        await expect(transcribe(new Blob([new Uint8Array([1])]))).rejects.toThrow(
            /No model selected/,
        );
    });

    it('throws when the active config no longer exists', async () => {
        vi.mocked(db.getActiveModelConfigId).mockResolvedValueOnce('mc-1');
        vi.mocked(db.getModelConfigWithApiKey).mockResolvedValueOnce(null);
        await expect(transcribe(new Blob([new Uint8Array([1])]))).rejects.toThrow(
            /no longer exists/,
        );
    });

    it('throws when no key in keychain for the api_key_id', async () => {
        vi.mocked(db.getActiveModelConfigId).mockResolvedValueOnce('mc-1');
        vi.mocked(db.getModelConfigWithApiKey).mockResolvedValueOnce({
            id: 'mc-1',
            apiKeyId: 'key-1',
            modelId: 'whisper-1',
            providerId: 'openai',
            apiKeyNickname: 'Personal',
        });
        vi.mocked(core.invoke).mockResolvedValueOnce(null);
        await expect(transcribe(new Blob([new Uint8Array([1])]))).rejects.toThrow(/No API key/);
    });

    it('returns text from the AI SDK on the happy path', async () => {
        vi.mocked(db.getActiveModelConfigId).mockResolvedValueOnce('mc-1');
        vi.mocked(db.getModelConfigWithApiKey).mockResolvedValueOnce({
            id: 'mc-1',
            apiKeyId: 'key-1',
            modelId: 'whisper-1',
            providerId: 'openai',
            apiKeyNickname: 'Personal',
        });
        vi.mocked(core.invoke).mockResolvedValueOnce('sk-test');
        const result = await transcribe(new Blob([new Uint8Array([1])]));
        expect(result).toBe('hello world');
        expect(core.invoke).toHaveBeenCalledWith('get_secret', { secretId: 'key-1' });
    });

    it('throws on unknown provider id', async () => {
        vi.mocked(db.getActiveModelConfigId).mockResolvedValueOnce('mc-1');
        vi.mocked(db.getModelConfigWithApiKey).mockResolvedValueOnce({
            id: 'mc-1',
            apiKeyId: 'key-1',
            modelId: 'whatever',
            providerId: 'does-not-exist',
            apiKeyNickname: 'X',
        });
        await expect(transcribe(new Blob([new Uint8Array([1])]))).rejects.toThrow(
            /Unknown provider/,
        );
    });

    it('PROVIDERS contains the expected provider ids', () => {
        const ids = PROVIDERS.map((p) => p.id).sort();
        expect(ids).toEqual([
            'assemblyai',
            'azure-openai',
            'deepgram',
            'elevenlabs',
            'fal',
            'gladia',
            'groq',
            'openai',
            'revai',
            'xai',
        ]);
    });
});
