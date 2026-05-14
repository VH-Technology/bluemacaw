import { invoke } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { DEFAULT_HOTKEY_MAC, DEFAULT_HOTKEY_OTHER } from './defaults';
import { getPlatform } from './use-platform';
import type { Theme } from './use-theme';

const DB_URL = 'sqlite:bluemacaw.db';
const ACTIVE_MODEL_CONFIG_KEY = 'active_model_config_id';
const OVERLAY_ENABLED_KEY = 'overlay_enabled';
const OVERLAY_X_KEY = 'overlay_x';
const OVERLAY_Y_KEY = 'overlay_y';
const SELECTED_MIC_DEVICE_KEY = 'selected_mic_device_id';
const HOTKEY_COMBO_KEY = 'hotkey_combo';
const CANCEL_HOTKEY_COMBO_KEY = 'cancel_hotkey_combo';
/** Default cancel hotkey applied when the user has never set one. Cmd+Esc
 * is a sensible macOS default — discoverable, not bound to anything else,
 * and requires a modifier so the combo parser accepts it (bare Esc would
 * be rejected and would also be a hostile thing to register globally). */
const DEFAULT_CANCEL_HOTKEY = 'Cmd+Esc';
const FN_USAGE_TYPE_ORIGINAL_KEY = 'fn_usage_type_original';
const RETENTION_DAYS_KEY = 'history_retention_days';
const HISTORY_LAST_SWEEP_KEY = 'history_last_sweep';
const THEME_KEY = 'theme';
const SOFT_DELETE_GRACE_DAYS = 30;

export interface ApiKeyRow {
    id: string;
    providerId: string;
    nickname: string;
    createdAt: string;
}

export interface OverlayPosition {
    x: number;
    y: number;
}

export interface ModelConfigWithApiKey {
    id: string;
    apiKeyId: string;
    modelId: string;
    providerId: string;
    apiKeyNickname: string;
}

export interface TranscriptionRow {
    id: number;
    createdAt: number;
    text: string;
    durationMs: number;
    wordCount: number;
    providerId: string;
    modelId: string;
}

let cached: Promise<Awaited<ReturnType<typeof Database.load>>> | null = null;
function db() {
    if (!cached) cached = Database.load(DB_URL);
    return cached;
}

function newId(): string {
    return crypto.randomUUID();
}

interface RawApiKey {
    id: string;
    provider_id: string;
    nickname: string;
    created_at: string;
}
interface RawModelConfigJoined {
    id: string;
    api_key_id: string;
    model_id: string;
    provider_id: string;
    nickname: string;
}

const SELECT_MODEL_CONFIGS_JOINED = `
    SELECT mc.id, mc.api_key_id, mc.model_id, ak.provider_id, ak.nickname
    FROM model_configs mc
    JOIN api_keys ak ON ak.id = mc.api_key_id
`;

function mapApiKey(r: RawApiKey): ApiKeyRow {
    return {
        id: r.id,
        providerId: r.provider_id,
        nickname: r.nickname,
        createdAt: r.created_at,
    };
}

function mapModelConfig(r: RawModelConfigJoined): ModelConfigWithApiKey {
    return {
        id: r.id,
        apiKeyId: r.api_key_id,
        modelId: r.model_id,
        providerId: r.provider_id,
        apiKeyNickname: r.nickname,
    };
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
    const conn = await db();
    const rows = (await conn.select(
        'SELECT id, provider_id, nickname, created_at FROM api_keys ORDER BY created_at',
    )) as RawApiKey[];
    return rows.map(mapApiKey);
}

export async function addApiKey(input: {
    providerId: string;
    nickname: string;
    secret: string;
}): Promise<ApiKeyRow> {
    const conn = await db();
    const id = newId();
    await conn.execute('INSERT INTO api_keys (id, provider_id, nickname) VALUES (?, ?, ?)', [
        id,
        input.providerId,
        input.nickname,
    ]);
    try {
        await invoke<void>('set_secret', { secretId: id, key: input.secret });
    } catch (err) {
        await conn.execute('DELETE FROM api_keys WHERE id = ?', [id]);
        throw err;
    }
    const rows = (await conn.select(
        'SELECT id, provider_id, nickname, created_at FROM api_keys WHERE id = ?',
        [id],
    )) as RawApiKey[];
    const row = rows[0];
    if (!row) throw new Error('Inserted api_key disappeared before read-back');
    return mapApiKey(row);
}

export async function deleteApiKey(id: string): Promise<void> {
    const conn = await db();
    const activeId = await getActiveModelConfigId();
    const dependents = await listModelConfigDependencies(id);
    await conn.execute('DELETE FROM api_keys WHERE id = ?', [id]);
    await invoke<void>('delete_secret', { secretId: id });
    if (activeId !== null && dependents.some((d) => d.id === activeId)) {
        await conn.execute('DELETE FROM app_state WHERE key = ?', [ACTIVE_MODEL_CONFIG_KEY]);
    }
}

export async function listModelConfigs(): Promise<ModelConfigWithApiKey[]> {
    const conn = await db();
    const rows = (await conn.select(
        `${SELECT_MODEL_CONFIGS_JOINED} ORDER BY mc.created_at`,
    )) as RawModelConfigJoined[];
    return rows.map(mapModelConfig);
}

export async function listModelConfigDependencies(
    apiKeyId: string,
): Promise<ModelConfigWithApiKey[]> {
    const conn = await db();
    const rows = (await conn.select(`${SELECT_MODEL_CONFIGS_JOINED} WHERE mc.api_key_id = ?`, [
        apiKeyId,
    ])) as RawModelConfigJoined[];
    return rows.map(mapModelConfig);
}

export async function addModelConfig(input: {
    apiKeyId: string;
    modelId: string;
}): Promise<ModelConfigWithApiKey> {
    const conn = await db();
    const id = newId();
    await conn.execute('INSERT INTO model_configs (id, api_key_id, model_id) VALUES (?, ?, ?)', [
        id,
        input.apiKeyId,
        input.modelId,
    ]);
    const rows = (await conn.select(`${SELECT_MODEL_CONFIGS_JOINED} WHERE mc.id = ?`, [
        id,
    ])) as RawModelConfigJoined[];
    const row = rows[0];
    if (!row) throw new Error('Inserted model_config disappeared before read-back');

    // Promote first-ever config to active so the recording loop has a target
    // without requiring the user to discover the click-to-activate UX.
    const currentActive = await getActiveModelConfigId();
    if (currentActive === null) {
        await setActiveModelConfigId(id);
    }

    return mapModelConfig(row);
}

export async function deleteModelConfig(id: string): Promise<void> {
    const conn = await db();
    const activeId = await getActiveModelConfigId();
    await conn.execute('DELETE FROM model_configs WHERE id = ?', [id]);
    if (activeId === id) {
        await conn.execute('DELETE FROM app_state WHERE key = ?', [ACTIVE_MODEL_CONFIG_KEY]);
    }
}

export async function getActiveModelConfigId(): Promise<string | null> {
    const conn = await db();
    const rows = (await conn.select('SELECT value FROM app_state WHERE key = ?', [
        ACTIVE_MODEL_CONFIG_KEY,
    ])) as { value: string }[];
    return rows[0]?.value ?? null;
}

export async function setActiveModelConfigId(id: string | null): Promise<void> {
    const conn = await db();
    if (id === null) {
        await conn.execute('DELETE FROM app_state WHERE key = ?', [ACTIVE_MODEL_CONFIG_KEY]);
        return;
    }
    await conn.execute(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [ACTIVE_MODEL_CONFIG_KEY, id],
    );
}

export async function getOverlayEnabled(): Promise<boolean> {
    const conn = await db();
    const rows = (await conn.select('SELECT value FROM app_state WHERE key = ?', [
        OVERLAY_ENABLED_KEY,
    ])) as { value: string }[];
    if (!rows[0]) return true;
    return rows[0].value === 'true';
}

export async function setOverlayEnabled(enabled: boolean): Promise<void> {
    const conn = await db();
    await conn.execute(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [OVERLAY_ENABLED_KEY, enabled ? 'true' : 'false'],
    );
}

export async function getOverlayPosition(): Promise<OverlayPosition | null> {
    const conn = await db();
    const rows = (await conn.select('SELECT key, value FROM app_state WHERE key IN (?, ?)', [
        OVERLAY_X_KEY,
        OVERLAY_Y_KEY,
    ])) as { key: string; value: string }[];
    const x = rows.find((r) => r.key === OVERLAY_X_KEY)?.value;
    const y = rows.find((r) => r.key === OVERLAY_Y_KEY)?.value;
    if (x === undefined || y === undefined) return null;
    const xn = Number.parseInt(x, 10);
    const yn = Number.parseInt(y, 10);
    if (!Number.isFinite(xn) || !Number.isFinite(yn)) return null;
    return { x: xn, y: yn };
}

export async function setOverlayPosition(pos: OverlayPosition): Promise<void> {
    const conn = await db();
    const upsert =
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';
    await conn.execute(upsert, [OVERLAY_X_KEY, String(Math.round(pos.x))]);
    await conn.execute(upsert, [OVERLAY_Y_KEY, String(Math.round(pos.y))]);
}

export async function getModelConfigWithApiKey(id: string): Promise<ModelConfigWithApiKey | null> {
    const conn = await db();
    const rows = (await conn.select(`${SELECT_MODEL_CONFIGS_JOINED} WHERE mc.id = ?`, [
        id,
    ])) as RawModelConfigJoined[];
    return rows[0] ? mapModelConfig(rows[0]) : null;
}

export async function getSelectedMicDeviceId(): Promise<string | null> {
    const conn = await db();
    const rows = (await conn.select('SELECT value FROM app_state WHERE key = ?', [
        SELECTED_MIC_DEVICE_KEY,
    ])) as { value: string }[];
    return rows[0]?.value ?? null;
}

export async function setSelectedMicDeviceId(id: string | null): Promise<void> {
    const conn = await db();
    if (id === null) {
        await conn.execute('DELETE FROM app_state WHERE key = ?', [SELECTED_MIC_DEVICE_KEY]);
        return;
    }
    await conn.execute(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [SELECTED_MIC_DEVICE_KEY, id],
    );
}

/**
 * Resolves the platform-appropriate default hotkey by asking Rust which
 * OS we're on (cached, single round-trip per process). Replaces the
 * legacy deprecated-DOM sniff that could return an empty string on newer
 * Chromium builds.
 */
async function defaultHotkeyCombo(): Promise<string> {
    const p = await getPlatform();
    return p.os === 'macos' ? DEFAULT_HOTKEY_MAC : DEFAULT_HOTKEY_OTHER;
}

export async function getHotkeyCombo(): Promise<string> {
    const conn = await db();
    const rows = (await conn.select('SELECT value FROM app_state WHERE key = ?', [
        HOTKEY_COMBO_KEY,
    ])) as { value: string }[];
    return rows[0]?.value ?? (await defaultHotkeyCombo());
}

export async function setHotkeyCombo(combo: string): Promise<void> {
    const conn = await db();
    await conn.execute(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [HOTKEY_COMBO_KEY, combo],
    );
}

export async function getCancelHotkeyCombo(): Promise<string> {
    const conn = await db();
    const rows = (await conn.select('SELECT value FROM app_state WHERE key = ?', [
        CANCEL_HOTKEY_COMBO_KEY,
    ])) as { value: string }[];
    return rows[0]?.value ?? DEFAULT_CANCEL_HOTKEY;
}

export async function setCancelHotkeyCombo(combo: string): Promise<void> {
    const conn = await db();
    await conn.execute(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [CANCEL_HOTKEY_COMBO_KEY, combo],
    );
}

/**
 * Returns the AppleFnUsageType value that was in place before bluemacaw changed
 * it, or null if bluemacaw has never modified the system setting. Used to
 * restore the user's original preference when they switch away from the Fn
 * hotkey.
 */
export async function getOriginalFnUsageType(): Promise<number | null> {
    const conn = await db();
    const rows = (await conn.select('SELECT value FROM app_state WHERE key = ?', [
        FN_USAGE_TYPE_ORIGINAL_KEY,
    ])) as { value: string }[];
    if (!rows[0]) return null;
    const n = Number.parseInt(rows[0].value, 10);
    return Number.isFinite(n) ? n : null;
}

export async function setOriginalFnUsageType(value: number): Promise<void> {
    const conn = await db();
    await conn.execute(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [FN_USAGE_TYPE_ORIGINAL_KEY, String(value)],
    );
}

export async function clearOriginalFnUsageType(): Promise<void> {
    const conn = await db();
    await conn.execute('DELETE FROM app_state WHERE key = ?', [FN_USAGE_TYPE_ORIGINAL_KEY]);
}

function countWords(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
}

export async function saveTranscription(input: {
    text: string;
    durationMs: number;
    providerId: string;
    modelId: string;
}): Promise<void> {
    const conn = await db();
    await conn.execute(
        'INSERT INTO transcriptions (created_at, text, duration_ms, word_count, provider_id, model_id) VALUES (?, ?, ?, ?, ?, ?)',
        [
            Date.now(),
            input.text,
            input.durationMs,
            countWords(input.text),
            input.providerId,
            input.modelId,
        ],
    );
}

interface RawTranscription {
    id: number;
    created_at: number;
    text: string;
    duration_ms: number;
    word_count: number;
    provider_id: string;
    model_id: string;
}

export async function listTranscriptions(
    options: { limit?: number; offset?: number } = {},
): Promise<TranscriptionRow[]> {
    const conn = await db();
    const limit = options.limit ?? 200;
    const offset = options.offset ?? 0;
    const rows = (await conn.select(
        'SELECT id, created_at, text, duration_ms, word_count, provider_id, model_id FROM transcriptions WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [limit, offset],
    )) as RawTranscription[];
    return rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        text: r.text,
        durationMs: r.duration_ms,
        wordCount: r.word_count,
        providerId: r.provider_id,
        modelId: r.model_id,
    }));
}

export async function softDeleteTranscription(id: number): Promise<void> {
    const conn = await db();
    await conn.execute('UPDATE transcriptions SET deleted_at = ? WHERE id = ?', [Date.now(), id]);
}

export async function restoreTranscription(id: number): Promise<void> {
    const conn = await db();
    await conn.execute('UPDATE transcriptions SET deleted_at = NULL WHERE id = ?', [id]);
}

export async function hardDeleteTranscription(id: number): Promise<void> {
    const conn = await db();
    await conn.execute('DELETE FROM transcriptions WHERE id = ?', [id]);
}

export async function clearAllTranscriptions(): Promise<{ deleted: number }> {
    const conn = await db();
    const result = (await conn.execute('DELETE FROM transcriptions', [])) as {
        rowsAffected: number;
    };
    return { deleted: result.rowsAffected };
}

export async function getRetentionDays(): Promise<number> {
    const conn = await db();
    const rows = (await conn.select('SELECT value FROM app_state WHERE key = ?', [
        RETENTION_DAYS_KEY,
    ])) as { value: string }[];
    if (!rows[0]) return 365;
    const n = Number.parseInt(rows[0].value, 10);
    return Number.isFinite(n) ? n : 365;
}

export async function setRetentionDays(days: number): Promise<void> {
    const conn = await db();
    await conn.execute(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [RETENTION_DAYS_KEY, String(days)],
    );
}

export async function getHistoryLastSweep(): Promise<number | null> {
    const conn = await db();
    const rows = (await conn.select('SELECT value FROM app_state WHERE key = ?', [
        HISTORY_LAST_SWEEP_KEY,
    ])) as { value: string }[];
    if (!rows[0]) return null;
    const n = Number.parseInt(rows[0].value, 10);
    return Number.isFinite(n) ? n : null;
}

export async function setHistoryLastSweep(ms: number): Promise<void> {
    const conn = await db();
    await conn.execute(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [HISTORY_LAST_SWEEP_KEY, String(ms)],
    );
}

export async function getTheme(): Promise<Theme> {
    const conn = await db();
    const rows = (await conn.select('SELECT value FROM app_state WHERE key = ?', [THEME_KEY])) as {
        value: string;
    }[];
    const value = rows[0]?.value;
    if (value === 'light' || value === 'dark' || value === 'system') return value;
    return 'system';
}

export async function setTheme(value: Theme): Promise<void> {
    const conn = await db();
    await conn.execute(
        'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [THEME_KEY, value],
    );
}

export async function purgeOlderThan(
    retentionDays: number,
    /**
     * Override the wall clock used to compute the soft-delete and
     * hard-delete cutoffs. Production callers should leave this unset —
     * `Date.now()` is the right value. Tests pass a fixed timestamp so
     * that the boundary case (`created_at === cutoff`) is deterministic;
     * otherwise even a one-ms gap between the test's `now` and the
     * function's `now` flips the comparison and the test soft-deletes a
     * row it expected to keep (observed under CI's slower scheduler).
     */
    now: number = Date.now(),
): Promise<{ softDeleted: number; hardDeleted: number }> {
    const conn = await db();
    let softDeleted = 0;
    if (retentionDays > 0) {
        const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
        const r = (await conn.execute(
            'UPDATE transcriptions SET deleted_at = ? WHERE created_at < ? AND deleted_at IS NULL',
            [now, cutoff],
        )) as { rowsAffected: number };
        softDeleted = r.rowsAffected;
    }
    const graceCutoff = now - SOFT_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000;
    const r = (await conn.execute(
        'DELETE FROM transcriptions WHERE deleted_at IS NOT NULL AND deleted_at < ?',
        [graceCutoff],
    )) as { rowsAffected: number };
    return { softDeleted, hardDeleted: r.rowsAffected };
}

export interface HistoryStats {
    totalWords: number;
    streakDays: number;
    avgWPM: number | null;
    timeSavedMinutes: number;
    topProvider: string | null;
}

export type HistoryStatsRange = 'week' | 'month' | 'all';

interface RawStatsRow {
    provider_id: string;
    word_count: number;
    duration_ms: number;
    created_at: number;
}

function rangeStartMs(range: HistoryStatsRange, now: number): number | null {
    const day = 24 * 60 * 60 * 1000;
    if (range === 'week') return now - 7 * day;
    if (range === 'month') return now - 30 * day;
    return null;
}

function computeStreakDays(rows: RawStatsRow[], now: number): number {
    if (rows.length === 0) return 0;
    const day = 24 * 60 * 60 * 1000;
    const startOfDay = (ms: number) => {
        const d = new Date(ms);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    };
    const today = startOfDay(now);
    const days = new Set<number>(rows.map((r) => startOfDay(r.created_at)));
    let streak = 0;
    let cursor = today;
    while (days.has(cursor)) {
        streak++;
        cursor -= day;
    }
    return streak;
}

export async function getHistoryStats(range: HistoryStatsRange): Promise<HistoryStats> {
    const conn = await db();
    const now = Date.now();
    const start = rangeStartMs(range, now);
    const rows = (await conn.select(
        start === null
            ? 'SELECT provider_id, word_count, duration_ms, created_at FROM transcriptions WHERE deleted_at IS NULL'
            : 'SELECT provider_id, word_count, duration_ms, created_at FROM transcriptions WHERE deleted_at IS NULL AND created_at >= ?',
        start === null ? [] : [start],
    )) as RawStatsRow[];
    if (rows.length === 0) {
        return {
            totalWords: 0,
            streakDays: 0,
            avgWPM: null,
            timeSavedMinutes: 0,
            topProvider: null,
        };
    }
    const totalWords = rows.reduce((a, r) => a + r.word_count, 0);
    const totalMs = rows.reduce((a, r) => a + r.duration_ms, 0);
    const totalMinutes = totalMs / 60000;
    const avgWPM = totalMs > 0 ? totalWords / totalMinutes : null;
    const typingMinutes = totalWords / 45;
    const timeSavedMinutes = Math.max(0, typingMinutes - totalMinutes);
    const counts = new Map<string, number>();
    for (const r of rows) {
        counts.set(r.provider_id, (counts.get(r.provider_id) ?? 0) + 1);
    }
    let topProvider: string | null = null;
    let topCount = 0;
    for (const [p, c] of counts) {
        if (c > topCount) {
            topProvider = p;
            topCount = c;
        }
    }
    return {
        totalWords,
        streakDays: computeStreakDays(rows, now),
        avgWPM,
        timeSavedMinutes,
        topProvider,
    };
}
