import * as core from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSharedHarness, resetSharedHarness } from './__tests__/db-harness';
import { __resetPlatformCacheForTests } from './use-platform';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

// Route every `Database.load(...)` call through a single in-memory SQLite
// harness so the JS facade exercises real SQL against the real migrations
// shared with the Rust side (src-tauri/migrations/*.sql).
vi.mock('@tauri-apps/plugin-sql', () => ({
    default: { load: vi.fn(async () => getSharedHarness()) },
}));

import {
    addApiKey,
    addModelConfig,
    clearAllTranscriptions,
    clearOriginalFnUsageType,
    deleteApiKey,
    deleteModelConfig,
    getActiveModelConfigId,
    getHistoryLastSweep,
    getHistoryStats,
    getHotkeyCombo,
    getModelConfigWithApiKey,
    getOriginalFnUsageType,
    getOverlayEnabled,
    getOverlayPosition,
    getRetentionDays,
    getSelectedMicDeviceId,
    getTheme,
    hardDeleteTranscription,
    listApiKeys,
    listModelConfigDependencies,
    listModelConfigs,
    listTranscriptions,
    purgeOlderThan,
    restoreTranscription,
    saveTranscription,
    setActiveModelConfigId,
    setHistoryLastSweep,
    setHotkeyCombo,
    setOriginalFnUsageType,
    setOverlayEnabled,
    setOverlayPosition,
    setRetentionDays,
    setSelectedMicDeviceId,
    setTheme,
    softDeleteTranscription,
} from './db';

// Time helpers. Tests that depend on "today" wall clock are written
// relative to Date.now() at call time so they don't drift across midnight.
const DAY_MS = 24 * 60 * 60 * 1000;

/** Insert a transcription row directly via the public helper, returning the inserted id. */
async function insertTranscription(input: {
    text?: string;
    durationMs?: number;
    providerId?: string;
    modelId?: string;
    createdAt?: number;
    deletedAt?: number | null;
}): Promise<number> {
    // Use saveTranscription for the realistic path; if a custom
    // createdAt/deletedAt is requested, patch the row directly via raw SQL.
    await saveTranscription({
        text: input.text ?? 'hello world',
        durationMs: input.durationMs ?? 1000,
        providerId: input.providerId ?? 'openai',
        modelId: input.modelId ?? 'whisper-1',
    });
    const harness = getSharedHarness();
    const rows = await harness.select<{ id: number }>(
        'SELECT id FROM transcriptions ORDER BY id DESC LIMIT 1',
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('inserted row not found');
    if (input.createdAt !== undefined || input.deletedAt !== undefined) {
        await harness.execute(
            'UPDATE transcriptions SET created_at = COALESCE(?, created_at), deleted_at = ? WHERE id = ?',
            [input.createdAt ?? null, input.deletedAt === undefined ? null : input.deletedAt, id],
        );
    }
    return id;
}

beforeEach(() => {
    vi.mocked(core.invoke).mockReset();
    vi.mocked(Database.load).mockClear();
    resetSharedHarness();
    __resetPlatformCacheForTests();
});

// ----------------------------------------------------------------------
// api_keys CRUD
// ----------------------------------------------------------------------

describe('db.listApiKeys', () => {
    it('returns rows ordered by created_at', async () => {
        // Two raw inserts with explicit created_at so ordering is deterministic.
        const h = getSharedHarness();
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname, created_at) VALUES ('a', 'openai', 'Older', '2026-05-01')",
        );
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname, created_at) VALUES ('b', 'groq', 'Newer', '2026-05-09')",
        );
        const rows = await listApiKeys();
        expect(rows).toEqual([
            { id: 'a', providerId: 'openai', nickname: 'Older', createdAt: '2026-05-01' },
            { id: 'b', providerId: 'groq', nickname: 'Newer', createdAt: '2026-05-09' },
        ]);
    });

    it('returns [] when the table is empty', async () => {
        await expect(listApiKeys()).resolves.toEqual([]);
    });
});

describe('db.addApiKey', () => {
    it('inserts a row, writes the secret, and returns the persisted row', async () => {
        vi.mocked(core.invoke).mockResolvedValueOnce(undefined);
        const row = await addApiKey({
            providerId: 'openai',
            nickname: 'Personal',
            secret: 'sk-test',
        });
        expect(row.providerId).toBe('openai');
        expect(row.nickname).toBe('Personal');
        expect(row.id).toMatch(/^[0-9a-f-]{36}$/i);
        // The row really exists.
        const all = await listApiKeys();
        expect(all).toHaveLength(1);
        expect(all[0]?.id).toBe(row.id);
        // The vault was invoked with the new id and the raw secret.
        expect(core.invoke).toHaveBeenCalledWith('set_secret', {
            secretId: row.id,
            key: 'sk-test',
        });
    });

    it('rolls back the SQL row when the vault write fails', async () => {
        vi.mocked(core.invoke).mockRejectedValueOnce(new Error('keychain denied'));
        await expect(
            addApiKey({ providerId: 'openai', nickname: 'X', secret: 'sk' }),
        ).rejects.toThrow(/keychain/);
        // No leaked row.
        await expect(listApiKeys()).resolves.toEqual([]);
    });
});

describe('db.deleteApiKey', () => {
    it('removes the row, deletes the secret, and clears active when its config is dependent', async () => {
        const h = getSharedHarness();
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname) VALUES ('key-1', 'openai', 'A')",
        );
        await h.execute(
            "INSERT INTO model_configs (id, api_key_id, model_id) VALUES ('mc-1', 'key-1', 'whisper-1')",
        );
        await setActiveModelConfigId('mc-1');
        vi.mocked(core.invoke).mockResolvedValueOnce(undefined);

        await deleteApiKey('key-1');

        await expect(listApiKeys()).resolves.toEqual([]);
        await expect(getActiveModelConfigId()).resolves.toBeNull();
        expect(core.invoke).toHaveBeenCalledWith('delete_secret', { secretId: 'key-1' });
    });

    it('does not clear active when the active config belongs to another key', async () => {
        const h = getSharedHarness();
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname) VALUES ('key-1', 'openai', 'A')",
        );
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname) VALUES ('key-2', 'openai', 'B')",
        );
        await h.execute(
            "INSERT INTO model_configs (id, api_key_id, model_id) VALUES ('mc-keep', 'key-2', 'whisper-1')",
        );
        await setActiveModelConfigId('mc-keep');
        vi.mocked(core.invoke).mockResolvedValueOnce(undefined);

        await deleteApiKey('key-1');

        await expect(getActiveModelConfigId()).resolves.toBe('mc-keep');
    });

    it('cascades to model_configs via the FK ON DELETE CASCADE', async () => {
        const h = getSharedHarness();
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname) VALUES ('key-1', 'openai', 'A')",
        );
        await h.execute(
            "INSERT INTO model_configs (id, api_key_id, model_id) VALUES ('mc-1', 'key-1', 'whisper-1')",
        );
        vi.mocked(core.invoke).mockResolvedValueOnce(undefined);
        await deleteApiKey('key-1');
        await expect(listModelConfigs()).resolves.toEqual([]);
    });
});

// ----------------------------------------------------------------------
// model_configs
// ----------------------------------------------------------------------

describe('db.listModelConfigDependencies', () => {
    it('returns only the model_configs that point at the given api_key', async () => {
        const h = getSharedHarness();
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname) VALUES ('key-1', 'openai', 'Personal')",
        );
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname) VALUES ('key-2', 'groq', 'Work')",
        );
        await h.execute(
            "INSERT INTO model_configs (id, api_key_id, model_id) VALUES ('mc-1', 'key-1', 'whisper-1')",
        );
        await h.execute(
            "INSERT INTO model_configs (id, api_key_id, model_id) VALUES ('mc-2', 'key-2', 'whisper-large-v3')",
        );
        const rows = await listModelConfigDependencies('key-1');
        expect(rows).toEqual([
            {
                id: 'mc-1',
                apiKeyId: 'key-1',
                modelId: 'whisper-1',
                providerId: 'openai',
                apiKeyNickname: 'Personal',
            },
        ]);
    });
});

describe('db.listModelConfigs', () => {
    it('returns model configs joined with api_keys', async () => {
        const h = getSharedHarness();
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname) VALUES ('key-1', 'openai', 'Personal')",
        );
        await h.execute(
            "INSERT INTO model_configs (id, api_key_id, model_id) VALUES ('mc-1', 'key-1', 'whisper-1')",
        );
        const rows = await listModelConfigs();
        expect(rows[0]?.providerId).toBe('openai');
        expect(rows[0]?.apiKeyNickname).toBe('Personal');
        expect(rows[0]?.modelId).toBe('whisper-1');
    });
});

describe('db.addModelConfig', () => {
    it('inserts a row and auto-promotes the first config to active', async () => {
        const h = getSharedHarness();
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname) VALUES ('key-1', 'openai', 'Personal')",
        );
        const row = await addModelConfig({ apiKeyId: 'key-1', modelId: 'whisper-1' });
        expect(row.apiKeyId).toBe('key-1');
        expect(row.modelId).toBe('whisper-1');
        // Auto-promotion kicked in.
        await expect(getActiveModelConfigId()).resolves.toBe(row.id);
    });

    it('does not change the active selection when one already exists', async () => {
        const h = getSharedHarness();
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname) VALUES ('key-1', 'openai', 'Personal')",
        );
        await setActiveModelConfigId('mc-existing');
        await addModelConfig({ apiKeyId: 'key-1', modelId: 'whisper-1' });
        await expect(getActiveModelConfigId()).resolves.toBe('mc-existing');
    });
});

describe('db.deleteModelConfig', () => {
    it('clears active selection when the deleted config was active', async () => {
        const h = getSharedHarness();
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname) VALUES ('key-1', 'openai', 'A')",
        );
        await h.execute(
            "INSERT INTO model_configs (id, api_key_id, model_id) VALUES ('mc-1', 'key-1', 'whisper-1')",
        );
        await setActiveModelConfigId('mc-1');
        await deleteModelConfig('mc-1');
        await expect(listModelConfigs()).resolves.toEqual([]);
        await expect(getActiveModelConfigId()).resolves.toBeNull();
    });

    it('keeps active selection when deleting a non-active config', async () => {
        const h = getSharedHarness();
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname) VALUES ('key-1', 'openai', 'A')",
        );
        await h.execute(
            "INSERT INTO model_configs (id, api_key_id, model_id) VALUES ('mc-1', 'key-1', 'whisper-1')",
        );
        await h.execute(
            "INSERT INTO model_configs (id, api_key_id, model_id) VALUES ('mc-keep', 'key-1', 'whisper-large-v3')",
        );
        await setActiveModelConfigId('mc-keep');
        await deleteModelConfig('mc-1');
        await expect(getActiveModelConfigId()).resolves.toBe('mc-keep');
    });
});

// ----------------------------------------------------------------------
// app_state key/value pairs
// ----------------------------------------------------------------------

describe('db.activeModelConfigId', () => {
    it('returns null when no row exists', async () => {
        await expect(getActiveModelConfigId()).resolves.toBeNull();
    });

    it('returns the value when set', async () => {
        await setActiveModelConfigId('mc-1');
        await expect(getActiveModelConfigId()).resolves.toBe('mc-1');
    });

    it('overwrites prior values (UPSERT semantics)', async () => {
        await setActiveModelConfigId('mc-1');
        await setActiveModelConfigId('mc-2');
        await expect(getActiveModelConfigId()).resolves.toBe('mc-2');
    });

    it('deletes when setting null', async () => {
        await setActiveModelConfigId('mc-1');
        await setActiveModelConfigId(null);
        await expect(getActiveModelConfigId()).resolves.toBeNull();
    });
});

describe('db.overlayEnabled', () => {
    it('returns true when no row exists (default)', async () => {
        await expect(getOverlayEnabled()).resolves.toBe(true);
    });

    it('returns true when stored value is "true"', async () => {
        await setOverlayEnabled(true);
        await expect(getOverlayEnabled()).resolves.toBe(true);
    });

    it('returns false when stored value is "false"', async () => {
        await setOverlayEnabled(false);
        await expect(getOverlayEnabled()).resolves.toBe(false);
    });

    it('upserts the value rather than appending a duplicate row', async () => {
        await setOverlayEnabled(true);
        await setOverlayEnabled(false);
        await setOverlayEnabled(true);
        // Round-trip: only one row, with the latest value.
        const rows = await getSharedHarness().select<{ count: number }>(
            "SELECT COUNT(*) as count FROM app_state WHERE key = 'overlay_enabled'",
        );
        expect(rows[0]?.count).toBe(1);
        await expect(getOverlayEnabled()).resolves.toBe(true);
    });
});

describe('db.overlayPosition', () => {
    it('returns null when no rows exist', async () => {
        await expect(getOverlayPosition()).resolves.toBeNull();
    });

    it('returns null when only x exists', async () => {
        await getSharedHarness().execute(
            "INSERT INTO app_state (key, value) VALUES ('overlay_x', '100')",
        );
        await expect(getOverlayPosition()).resolves.toBeNull();
    });

    it('returns {x, y} when both rows exist', async () => {
        await setOverlayPosition({ x: 100, y: 200 });
        await expect(getOverlayPosition()).resolves.toEqual({ x: 100, y: 200 });
    });

    it('returns null when stored values are non-numeric', async () => {
        const h = getSharedHarness();
        await h.execute("INSERT INTO app_state (key, value) VALUES ('overlay_x', 'oops')");
        await h.execute("INSERT INTO app_state (key, value) VALUES ('overlay_y', 'nope')");
        await expect(getOverlayPosition()).resolves.toBeNull();
    });

    it('rounds float coordinates before persisting', async () => {
        await setOverlayPosition({ x: 100.7, y: 200.3 });
        await expect(getOverlayPosition()).resolves.toEqual({ x: 101, y: 200 });
    });

    it('upserting twice keeps only one row per key', async () => {
        await setOverlayPosition({ x: 1, y: 2 });
        await setOverlayPosition({ x: 3, y: 4 });
        const rows = await getSharedHarness().select<{ count: number }>(
            "SELECT COUNT(*) AS count FROM app_state WHERE key IN ('overlay_x','overlay_y')",
        );
        expect(rows[0]?.count).toBe(2);
        await expect(getOverlayPosition()).resolves.toEqual({ x: 3, y: 4 });
    });
});

describe('db.getModelConfigWithApiKey', () => {
    it('returns null when not found', async () => {
        await expect(getModelConfigWithApiKey('nope')).resolves.toBeNull();
    });

    it('returns the joined row when found', async () => {
        const h = getSharedHarness();
        await h.execute(
            "INSERT INTO api_keys (id, provider_id, nickname) VALUES ('key-1', 'openai', 'Personal')",
        );
        await h.execute(
            "INSERT INTO model_configs (id, api_key_id, model_id) VALUES ('mc-1', 'key-1', 'whisper-1')",
        );
        await expect(getModelConfigWithApiKey('mc-1')).resolves.toEqual({
            id: 'mc-1',
            apiKeyId: 'key-1',
            modelId: 'whisper-1',
            providerId: 'openai',
            apiKeyNickname: 'Personal',
        });
    });
});

describe('db.selectedMicDeviceId', () => {
    it('returns null when not set', async () => {
        await expect(getSelectedMicDeviceId()).resolves.toBeNull();
    });
    it('returns the persisted value', async () => {
        await setSelectedMicDeviceId('USB Mic');
        await expect(getSelectedMicDeviceId()).resolves.toBe('USB Mic');
    });
    it('persists null by deleting the row', async () => {
        await setSelectedMicDeviceId('USB Mic');
        await setSelectedMicDeviceId(null);
        await expect(getSelectedMicDeviceId()).resolves.toBeNull();
        const rows = await getSharedHarness().select<{ count: number }>(
            "SELECT COUNT(*) as count FROM app_state WHERE key = 'selected_mic_device_id'",
        );
        expect(rows[0]?.count).toBe(0);
    });
});

describe('db.hotkeyCombo', () => {
    it('returns the macOS default when not set on macOS', async () => {
        vi.mocked(core.invoke).mockResolvedValueOnce({ os: 'macos', isWayland: false });
        await expect(getHotkeyCombo()).resolves.toBe('Cmd+Shift+Space');
    });
    it('returns the non-macOS default when not set on Windows/Linux', async () => {
        vi.mocked(core.invoke).mockResolvedValueOnce({ os: 'windows', isWayland: false });
        await expect(getHotkeyCombo()).resolves.toBe('Ctrl+Shift+Space');
    });
    it('returns the persisted combo regardless of platform', async () => {
        await setHotkeyCombo('Cmd+Alt+R');
        await expect(getHotkeyCombo()).resolves.toBe('Cmd+Alt+R');
        expect(core.invoke).not.toHaveBeenCalled();
    });
    it('overwrites on subsequent setHotkeyCombo calls (no duplicate rows)', async () => {
        await setHotkeyCombo('Cmd+Alt+R');
        await setHotkeyCombo('Cmd+Alt+T');
        await expect(getHotkeyCombo()).resolves.toBe('Cmd+Alt+T');
    });
});

describe('db.originalFnUsageType', () => {
    it('returns null when not set', async () => {
        await expect(getOriginalFnUsageType()).resolves.toBeNull();
    });
    it('returns the persisted integer', async () => {
        await setOriginalFnUsageType(2);
        await expect(getOriginalFnUsageType()).resolves.toBe(2);
    });
    it('returns null when the stored value is not a finite number', async () => {
        await getSharedHarness().execute(
            "INSERT INTO app_state (key, value) VALUES ('fn_usage_type_original', 'nope')",
        );
        await expect(getOriginalFnUsageType()).resolves.toBeNull();
    });
    it('clearOriginalFnUsageType removes the row', async () => {
        await setOriginalFnUsageType(1);
        await clearOriginalFnUsageType();
        await expect(getOriginalFnUsageType()).resolves.toBeNull();
    });
});

// ----------------------------------------------------------------------
// transcriptions CRUD
// ----------------------------------------------------------------------

describe('db.saveTranscription / listTranscriptions', () => {
    it('persists a row that listTranscriptions returns with the same fields', async () => {
        await saveTranscription({
            text: 'hello world',
            durationMs: 1234,
            providerId: 'openai',
            modelId: 'whisper-1',
        });
        const rows = await listTranscriptions({ limit: 10 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            text: 'hello world',
            durationMs: 1234,
            providerId: 'openai',
            modelId: 'whisper-1',
            wordCount: 2,
        });
        // created_at is stamped with Date.now() and present as a number.
        expect(typeof rows[0]?.createdAt).toBe('number');
    });

    it('counts words by whitespace splits and stores 0 for an empty trimmed string', async () => {
        await saveTranscription({
            text: '   ',
            durationMs: 0,
            providerId: 'openai',
            modelId: 'whisper-1',
        });
        const rows = await listTranscriptions({ limit: 10 });
        expect(rows[0]?.wordCount).toBe(0);
    });

    it('orders rows by created_at DESC and supports limit + offset', async () => {
        await insertTranscription({ text: 'oldest', createdAt: 1000 });
        await insertTranscription({ text: 'middle', createdAt: 2000 });
        await insertTranscription({ text: 'newest', createdAt: 3000 });
        const page1 = await listTranscriptions({ limit: 2, offset: 0 });
        const page2 = await listTranscriptions({ limit: 2, offset: 2 });
        expect(page1.map((r) => r.text)).toEqual(['newest', 'middle']);
        expect(page2.map((r) => r.text)).toEqual(['oldest']);
    });

    it('excludes soft-deleted rows from listTranscriptions', async () => {
        const id = await insertTranscription({ text: 'visible' });
        await insertTranscription({ text: 'hidden', deletedAt: Date.now() });
        const rows = await listTranscriptions({ limit: 10 });
        expect(rows.map((r) => r.text)).toEqual(['visible']);
        // sanity: the soft-deleted row is still in the table.
        const all = await getSharedHarness().select<{ count: number }>(
            'SELECT COUNT(*) as count FROM transcriptions',
        );
        expect(all[0]?.count).toBe(2);
        // and id-roundtrip works for the visible row.
        expect(rows[0]?.id).toBe(id);
    });
});

describe('db.softDeleteTranscription', () => {
    it('marks the row deleted but keeps it in the table', async () => {
        const id = await insertTranscription({ text: 'gone' });
        const before = Date.now();
        await softDeleteTranscription(id);
        const rows = await getSharedHarness().select<{ deleted_at: number | null }>(
            'SELECT deleted_at FROM transcriptions WHERE id = ?',
            [id],
        );
        expect(rows[0]?.deleted_at).not.toBeNull();
        expect(rows[0]?.deleted_at ?? 0).toBeGreaterThanOrEqual(before);
        // listTranscriptions hides it.
        await expect(listTranscriptions({ limit: 10 })).resolves.toEqual([]);
    });
});

describe('db.restoreTranscription', () => {
    it('clears deleted_at and brings the row back into listTranscriptions', async () => {
        const id = await insertTranscription({ text: 'back' });
        await softDeleteTranscription(id);
        await restoreTranscription(id);
        const rows = await listTranscriptions({ limit: 10 });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBe(id);
    });

    it('soft-delete then restore preserves every column byte-for-byte', async () => {
        const original = {
            text: 'A non-trivial body — with em-dash, emoji 👋 and  multiple   spaces  ',
            durationMs: 4321,
            providerId: 'groq',
            modelId: 'whisper-large-v3',
        };
        await saveTranscription(original);
        const [before] = await listTranscriptions({ limit: 1 });
        expect(before).toBeDefined();
        if (!before) throw new Error('precondition');

        await softDeleteTranscription(before.id);
        await restoreTranscription(before.id);

        const [after] = await listTranscriptions({ limit: 1 });
        // Round-trip must be exact: text, counts, durations, ids preserved.
        expect(after).toEqual(before);
    });
});

describe('db.hardDeleteTranscription', () => {
    it('removes the row from the table entirely', async () => {
        const id = await insertTranscription({ text: 'bye' });
        await hardDeleteTranscription(id);
        const rows = await getSharedHarness().select<{ count: number }>(
            'SELECT COUNT(*) as count FROM transcriptions WHERE id = ?',
            [id],
        );
        expect(rows[0]?.count).toBe(0);
    });
});

describe('db.clearAllTranscriptions', () => {
    it('hard-deletes every row and returns the count', async () => {
        await insertTranscription({ text: 'a' });
        await insertTranscription({ text: 'b' });
        await insertTranscription({ text: 'c' });
        const result = await clearAllTranscriptions();
        expect(result).toEqual({ deleted: 3 });
        await expect(listTranscriptions({ limit: 10 })).resolves.toEqual([]);
        // Stats reflect the empty table.
        const stats = await getHistoryStats('all');
        expect(stats.totalWords).toBe(0);
        expect(stats.avgWPM).toBeNull();
        expect(stats.streakDays).toBe(0);
    });

    it('also wipes soft-deleted rows', async () => {
        await insertTranscription({ text: 'live' });
        await insertTranscription({ text: 'dead', deletedAt: Date.now() });
        await clearAllTranscriptions();
        const rows = await getSharedHarness().select<{ count: number }>(
            'SELECT COUNT(*) as count FROM transcriptions',
        );
        expect(rows[0]?.count).toBe(0);
    });
});

// ----------------------------------------------------------------------
// retention / sweep / purge
// ----------------------------------------------------------------------

describe('db.retentionDays', () => {
    it('returns 365 default when not set', async () => {
        await expect(getRetentionDays()).resolves.toBe(365);
    });
    it('returns persisted value', async () => {
        await setRetentionDays(90);
        await expect(getRetentionDays()).resolves.toBe(90);
    });
    it('returns 365 fallback when the stored value is not a number', async () => {
        await getSharedHarness().execute(
            "INSERT INTO app_state (key, value) VALUES ('history_retention_days', 'oops')",
        );
        await expect(getRetentionDays()).resolves.toBe(365);
    });
});

describe('db.historyLastSweep', () => {
    it('returns null when not set', async () => {
        await expect(getHistoryLastSweep()).resolves.toBeNull();
    });
    it('returns persisted value', async () => {
        await setHistoryLastSweep(1700000000000);
        await expect(getHistoryLastSweep()).resolves.toBe(1700000000000);
    });
});

describe('db.theme', () => {
    it("returns 'system' default when not set", async () => {
        await expect(getTheme()).resolves.toBe('system');
    });
    it('round-trips light / dark / system', async () => {
        await setTheme('dark');
        await expect(getTheme()).resolves.toBe('dark');
        await setTheme('light');
        await expect(getTheme()).resolves.toBe('light');
        await setTheme('system');
        await expect(getTheme()).resolves.toBe('system');
    });
    it("falls back to 'system' when the stored value is garbage", async () => {
        await getSharedHarness().execute(
            "INSERT INTO app_state (key, value) VALUES ('theme', 'pink')",
        );
        await expect(getTheme()).resolves.toBe('system');
    });
});

describe('db.purgeOlderThan', () => {
    it('soft-deletes rows older than the retention window', async () => {
        const now = Date.now();
        await insertTranscription({ text: 'fresh', createdAt: now - 1 * DAY_MS });
        await insertTranscription({ text: 'stale', createdAt: now - 60 * DAY_MS });
        const result = await purgeOlderThan(30);
        expect(result.softDeleted).toBe(1);
        // The fresh row is still visible; the stale row is hidden.
        const visible = await listTranscriptions({ limit: 10 });
        expect(visible.map((r) => r.text)).toEqual(['fresh']);
    });

    it('skips the soft-delete step when retention is forever (-1)', async () => {
        await insertTranscription({ text: 'ancient', createdAt: 0 });
        const result = await purgeOlderThan(-1);
        expect(result.softDeleted).toBe(0);
        // Row is still visible because nothing was soft-deleted.
        const rows = await listTranscriptions({ limit: 10 });
        expect(rows).toHaveLength(1);
    });

    it('hard-deletes rows that have been soft-deleted longer than the 30-day grace period', async () => {
        const now = Date.now();
        await insertTranscription({
            text: 'long-gone',
            createdAt: now - 200 * DAY_MS,
            deletedAt: now - 31 * DAY_MS,
        });
        await insertTranscription({
            text: 'recently-deleted',
            createdAt: now - 10 * DAY_MS,
            deletedAt: now - 5 * DAY_MS,
        });
        const result = await purgeOlderThan(-1);
        expect(result.hardDeleted).toBe(1);
        const rows = await getSharedHarness().select<{ text: string }>(
            'SELECT text FROM transcriptions',
        );
        expect(rows.map((r) => r.text)).toEqual(['recently-deleted']);
    });

    it('a row created exactly at the retention cutoff is KEPT (uses strict < cutoff)', async () => {
        // Locks in the boundary behaviour: `created_at < cutoff` means the
        // exact cutoff value survives. If the comparison flips to `<=` this
        // test will fail loudly. The pinned `now` is essential — without
        // it, `purgeOlderThan` re-reads `Date.now()` internally, and any
        // sub-ms gap between the two reads pushes the function's cutoff
        // past the row's `created_at` and the boundary row gets deleted.
        // Reproduced on Ubuntu CI runners; macOS happened to land in the
        // same millisecond and the bug stayed hidden.
        const now = Date.now();
        const retentionDays = 30;
        const cutoff = now - retentionDays * DAY_MS;
        await insertTranscription({ text: 'boundary', createdAt: cutoff });
        const result = await purgeOlderThan(retentionDays, now);
        expect(result.softDeleted).toBe(0);
        const visible = await listTranscriptions({ limit: 10 });
        expect(visible.map((r) => r.text)).toEqual(['boundary']);
    });
});

// ----------------------------------------------------------------------
// stats
// ----------------------------------------------------------------------

describe('db.getHistoryStats', () => {
    it('aggregates total words, avg WPM, time saved, top provider, and streak', async () => {
        const now = Date.now();
        await insertTranscription({
            providerId: 'openai',
            text: 'one two three four five six seven eight nine ten',
            durationMs: 30_000,
            createdAt: now,
        });
        await insertTranscription({
            providerId: 'openai',
            text: Array.from({ length: 20 }, (_, i) => `w${i}`).join(' '),
            durationMs: 60_000,
            createdAt: now - 1 * DAY_MS,
        });
        await insertTranscription({
            providerId: 'groq',
            text: Array.from({ length: 30 }, (_, i) => `w${i}`).join(' '),
            durationMs: 90_000,
            createdAt: now - 2 * DAY_MS,
        });
        const stats = await getHistoryStats('all');
        expect(stats.totalWords).toBe(60);
        // 60 words in 3 minutes = 20 WPM.
        expect(stats.avgWPM).toBeCloseTo(20, 1);
        // typing at 45 WPM would take 60/45 ≈ 1.33 min, actual was 3 min → clamped to 0.
        expect(stats.timeSavedMinutes).toBe(0);
        expect(stats.topProvider).toBe('openai');
        expect(stats.streakDays).toBe(3);
    });

    it('returns zero/null on empty', async () => {
        const stats = await getHistoryStats('all');
        expect(stats.totalWords).toBe(0);
        expect(stats.avgWPM).toBeNull();
        expect(stats.streakDays).toBe(0);
        expect(stats.timeSavedMinutes).toBe(0);
        expect(stats.topProvider).toBeNull();
    });

    it('streakDays counts the consecutive run ending today, NOT the count of distinct days', async () => {
        // Days: today, today-1, (gap), today-3. The consecutive run ending
        // today is 2 days, NOT 3. This regression would silently pass with
        // the old SQL-substring tests.
        const now = Date.now();
        await insertTranscription({ providerId: 'openai', createdAt: now });
        await insertTranscription({ providerId: 'openai', createdAt: now - 1 * DAY_MS });
        await insertTranscription({ providerId: 'openai', createdAt: now - 3 * DAY_MS });
        const stats = await getHistoryStats('all');
        expect(stats.streakDays).toBe(2);
    });

    it('streakDays is 0 when the latest row is not today', async () => {
        const now = Date.now();
        await insertTranscription({ providerId: 'openai', createdAt: now - 1 * DAY_MS });
        await insertTranscription({ providerId: 'openai', createdAt: now - 2 * DAY_MS });
        const stats = await getHistoryStats('all');
        expect(stats.streakDays).toBe(0);
    });

    it('avgWPM is null — not NaN or Infinity — when every row has durationMs === 0', async () => {
        // Lock in the divide-by-zero guard. The current implementation
        // returns null when totalMs is 0, avoiding NaN/Infinity in the UI.
        await insertTranscription({ durationMs: 0, text: 'a b c' });
        const stats = await getHistoryStats('all');
        expect(stats.totalWords).toBe(3);
        expect(stats.avgWPM).toBeNull();
        expect(Number.isFinite(stats.avgWPM ?? 0)).toBe(true);
    });

    it('range=week excludes rows older than 7 days', async () => {
        const now = Date.now();
        await insertTranscription({ createdAt: now - 1 * DAY_MS, text: 'in' });
        await insertTranscription({ createdAt: now - 14 * DAY_MS, text: 'out' });
        const stats = await getHistoryStats('week');
        expect(stats.totalWords).toBe(1); // only 'in' counted
    });

    it('range=month excludes rows older than 30 days', async () => {
        const now = Date.now();
        await insertTranscription({ createdAt: now - 10 * DAY_MS, text: 'in' });
        await insertTranscription({ createdAt: now - 60 * DAY_MS, text: 'out' });
        const stats = await getHistoryStats('month');
        expect(stats.totalWords).toBe(1);
    });
});
