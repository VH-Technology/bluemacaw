import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import BetterSqlite3, { type Database as BetterSqlite3Database } from 'better-sqlite3';

/**
 * In-memory SQLite adapter that matches the public surface of
 * `@tauri-apps/plugin-sql`'s `Database`. Tests mock the plugin to return
 * an instance of this adapter so the JS `db.ts` facade exercises real
 * SQL against the SAME migration files the Rust side ships.
 *
 * Migration SQL lives in `src-tauri/migrations/*.sql` and is consumed
 * by Rust via `include_str!`. We read the same files here at construction
 * time so a typo'd column or missing index is caught by any test.
 */
export class HarnessDatabase {
    private readonly raw: BetterSqlite3Database;

    constructor() {
        this.raw = new BetterSqlite3(':memory:');
        // tauri-plugin-sql runs sqlite with foreign_keys on by default; mirror
        // that here so ON DELETE CASCADE fires in tests too.
        this.raw.pragma('foreign_keys = ON');
        for (const sql of loadMigrationSqlFiles()) {
            this.raw.exec(sql);
        }
    }

    /**
     * Mirror tauri-plugin-sql's `execute(sql, args)`: returns
     * `{ rowsAffected, lastInsertId }` and accepts positional `?`
     * placeholders. Wrapped in a Promise so the JS facade — which always
     * awaits — keeps working unchanged.
     */
    execute(
        sql: string,
        args: unknown[] = [],
    ): Promise<{ rowsAffected: number; lastInsertId: number }> {
        const stmt = this.raw.prepare(sql);
        const info = stmt.run(...(args as BetterSqlite3Params));
        return Promise.resolve({
            rowsAffected: info.changes,
            // SQLite returns a bigint for AUTOINCREMENT rowid; the plugin
            // coerces it to number on the Rust side, so do the same.
            lastInsertId: Number(info.lastInsertRowid),
        });
    }

    /**
     * Mirror tauri-plugin-sql's `select<T>(sql, args)`: returns an array of
     * plain rows. better-sqlite3 returns numbers as numbers and TEXT as
     * strings, which matches what the JS facade expects after the plugin's
     * serde_json round-trip on the Rust side.
     */
    select<T = unknown>(sql: string, args: unknown[] = []): Promise<T[]> {
        const stmt = this.raw.prepare(sql);
        const rows = stmt.all(...(args as BetterSqlite3Params));
        return Promise.resolve(rows as T[]);
    }

    /**
     * Drop and re-apply schema between tests. Cheaper than building a
     * fresh in-memory DB because we don't re-parse migration files.
     */
    reset(): void {
        this.raw.pragma('foreign_keys = OFF');
        const tables = this.raw
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .all() as { name: string }[];
        for (const { name } of tables) {
            this.raw.exec(`DROP TABLE IF EXISTS "${name}"`);
        }
        this.raw.pragma('foreign_keys = ON');
        for (const sql of loadMigrationSqlFiles()) {
            this.raw.exec(sql);
        }
    }

    close(): void {
        this.raw.close();
    }
}

// better-sqlite3 accepts a narrow params type; tests deal in unknown[] so
// we cast once here at the boundary.
type BetterSqlite3Params = readonly (string | number | bigint | Buffer | null)[];

let migrationCache: string[] | null = null;

function loadMigrationSqlFiles(): string[] {
    if (migrationCache) return migrationCache;
    // src/lib/__tests__/db-harness.ts → ../../../src-tauri/migrations.
    // `fileURLToPath` is the cross-platform way to turn a file: URL into a
    // filesystem path. On Windows, `new URL(import.meta.url).pathname`
    // would return `/D:/...` and path.resolve preserves the leading slash,
    // so fs.readFileSync ends up looking at `D:\D:\...` and ENOENTs.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(here, '../../../src-tauri/migrations');
    // Keep this list in the SAME order Rust's `migrations()` declares them.
    // New migrations must be appended here AND in src-tauri/src/history/mod.rs.
    const files = ['0001_init.sql', '0002_provider_configs.sql'];
    migrationCache = files.map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'));
    return migrationCache;
}

/**
 * Shared singleton harness for the test file. `reset()` is cheap and keeps
 * each test isolated without paying for module re-evaluation.
 */
let shared: HarnessDatabase | null = null;
export function getSharedHarness(): HarnessDatabase {
    if (!shared) shared = new HarnessDatabase();
    return shared;
}
export function resetSharedHarness(): void {
    getSharedHarness().reset();
}
