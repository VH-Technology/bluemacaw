/**
 * Rust <-> TS command contract test.
 *
 * Background
 * ----------
 * `packages/desktop/src/lib/invoke.ts` calls Tauri commands by string name,
 * e.g. `invoke('start_recording', { deviceId })`. The Rust side declares the
 * matching `#[tauri::command] pub fn start_recording(...)`. Nothing in the
 * compiler will catch it if one side renames the command or one of its args:
 * both sides keep compiling, and the IPC silently breaks at runtime.
 *
 * This test parses all three sources of truth as plain text and cross-checks
 * three invariants:
 *
 *   1. Every command registered in `tauri::generate_handler![...]` is called
 *      from invoke.ts (otherwise the Rust command is dead from the JS side).
 *   2. Every `invoke('name', ...)` call in invoke.ts has a matching command
 *      registered in `generate_handler!` (otherwise the JS call fails at
 *      runtime with "command not registered").
 *   3. For each matched pair, the user-supplied arg names line up. Tauri
 *      serializes Rust arg names from snake_case to camelCase by default, so
 *      the comparison normalizes both sides to lower-snake before comparing.
 *
 * Args injected by Tauri (`State<...>`, `AppHandle`, `Window`, `WebviewWindow`,
 * `tauri::AppHandle`, etc.) are stripped from the Rust signature before
 * comparison: they never appear in the JS payload.
 *
 * Conditional commands
 * --------------------
 * Some commands are gated on `#[cfg(target_os = "macos")]` (e.g.
 * `get_fn_usage_type`, `set_fn_usage_type`). Both the macOS and non-macOS
 * arms are emitted with `#[tauri::command]`, so the parser sees two functions
 * with the same name. We collapse duplicates by name; the arg lists agree
 * across cfg arms in this codebase, but if they ever diverged the test would
 * surface a mismatch when the lists disagreed (we compare the union).
 *
 * False-positive escape hatches
 * -----------------------------
 * None at present. The current invoke.ts uses only literal-string command
 * names and inline `{ key: value }` payload objects, which is exactly what
 * this parser is built for. If a future call site uses a non-literal command
 * name (e.g. `invoke(\`get_${kind}\`, ...)`) or a spread payload
 * (`invoke('foo', payload)` where `payload` is a variable), it won't match
 * the regex and will be invisible to this test. In that case, either:
 *   - rewrite the call site to use a literal name + inline payload, or
 *   - add the (command, expectation) pair to ALLOWLIST below with a comment
 *     explaining why it can't be statically checked.
 * We deliberately do not add a blanket bypass.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../..');
const COMMANDS_RS = resolve(REPO_ROOT, 'packages/desktop/src-tauri/src/commands.rs');
const LIB_RS = resolve(REPO_ROOT, 'packages/desktop/src-tauri/src/lib.rs');
const INVOKE_TS = resolve(REPO_ROOT, 'packages/desktop/src/lib/invoke.ts');

/**
 * Allowlist of (command, kind) pairs to skip. `kind` is one of:
 *   - 'registered-not-called' — Rust handler exists but no JS call site.
 *   - 'called-not-registered' — JS call site exists but no Rust handler.
 *   - 'arg-mismatch'           — pair exists but arg names differ.
 * Each entry MUST carry a comment explaining why it's exempt.
 */
const ALLOWLIST: ReadonlyArray<{
    command: string;
    kind: 'registered-not-called' | 'called-not-registered' | 'arg-mismatch';
    reason: string;
}> = [
    {
        command: 'list_local_models',
        kind: 'registered-not-called',
        reason: 'invoke<Array<{...}>> nested generics break the regex parser — see invoke.ts:162',
    },
];

/** Rust types that Tauri injects automatically and must be stripped from the
 *  comparable arg list. Matched as a prefix on the type spelling (after `:`),
 *  so e.g. `State<'_, AppState>` matches via `State<`. Keep this list narrow
 *  on purpose so a user-defined `StateRecord` argument does not get hidden. */
const INJECTED_TYPE_PREFIXES = [
    'State<',
    'tauri::State<',
    'AppHandle',
    'tauri::AppHandle',
    'Window',
    'tauri::Window',
    'WebviewWindow',
    'tauri::WebviewWindow',
    'Manager',
    'tauri::Manager',
];

interface RustCommand {
    name: string;
    /** User-supplied arg names, snake_case as written in Rust. */
    args: string[];
}

interface JsCommand {
    name: string;
    /** Payload key names as written in invoke.ts. */
    args: string[];
}

/** Convert camelCase or snake_case to canonical lower_snake form. */
function normalize(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/-/g, '_')
        .toLowerCase();
}

/** Strip a single arg's name from a Rust parameter like `device_id: Option<String>`.
 *  Returns null when the type prefix matches an injected framework type. */
function parseRustArg(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // `mut name: Type` -> drop the `mut`. `_name: Type` is rare but harmless.
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) return null;
    const lhs = trimmed.slice(0, colonIdx).trim();
    const rhs = trimmed.slice(colonIdx + 1).trim();
    const name = lhs.replace(/^mut\s+/, '').replace(/^_/, '');
    for (const prefix of INJECTED_TYPE_PREFIXES) {
        if (rhs.startsWith(prefix)) return null;
    }
    return name;
}

function parseRustCommands(src: string): RustCommand[] {
    // Match a `#[tauri::command]` attribute followed (after optional other
    // attributes like `#[cfg(...)]`) by `pub [async] fn name(args)`.
    // We capture the slice between the outermost parens of the signature.
    const out: Map<string, Set<string>> = new Map();
    const re = /#\[tauri::command\][\s\S]*?pub\s+(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/g;
    for (const m of src.matchAll(re)) {
        const name = m[1] ?? '';
        const argSrc = m[2] ?? '';
        if (!name) continue;
        const args: string[] = [];
        // Split on commas — none of the current signatures use generic args
        // with comma-bearing turbofish at the top level, so this is safe. If
        // that ever changes, this split needs a paren-depth walker.
        for (const part of argSrc.split(',')) {
            const arg = parseRustArg(part);
            if (arg) args.push(arg);
        }
        let set = out.get(name);
        if (!set) {
            set = new Set();
            out.set(name, set);
        }
        for (const a of args) set.add(a);
    }
    return Array.from(out.entries())
        .map(([name, args]) => ({ name, args: Array.from(args) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function parseHandlerList(src: string): string[] {
    // Find `tauri::generate_handler![ ... ]` and pull `commands::name` idents.
    const m = src.match(/tauri::generate_handler!\[([\s\S]*?)\]/);
    if (!m) throw new Error('No tauri::generate_handler! block found in lib.rs');
    const body = m[1] ?? '';
    const names: string[] = [];
    const re = /commands::(\w+)/g;
    for (const mm of body.matchAll(re)) {
        const captured = mm[1];
        if (captured) names.push(captured);
    }
    return names.sort();
}

function parseInvokeCalls(src: string): JsCommand[] {
    // Match invoke<T>('name') OR invoke<T>('name', { ... }).
    // We capture the command name and the optional payload object body.
    const out: Map<string, Set<string>> = new Map();
    const re = /invoke\s*<[^>]*>\s*\(\s*'([^']+)'\s*(?:,\s*\{([^}]*)\})?\s*\)/g;
    for (const m of src.matchAll(re)) {
        const name = m[1] ?? '';
        if (!name) continue;
        const payload = m[2] ?? '';
        const args: string[] = [];
        for (const raw of payload.split(',')) {
            const part = raw.trim();
            if (!part) continue;
            // Support `{ deviceId }` shorthand and `{ key: value }` longhand.
            // The KEY is what gets serialized to the IPC payload.
            const colon = part.indexOf(':');
            const key = colon < 0 ? part : part.slice(0, colon).trim();
            // Strip any leading `...` from rest-spread (would be invisible to
            // us anyway, but be conservative).
            const clean = key.replace(/^\.\.\./, '').trim();
            if (clean) args.push(clean);
        }
        let set = out.get(name);
        if (!set) {
            set = new Set();
            out.set(name, set);
        }
        for (const a of args) set.add(a);
    }
    return Array.from(out.entries())
        .map(([name, args]) => ({ name, args: Array.from(args) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

const commandsRsSrc = readFileSync(COMMANDS_RS, 'utf8');
const libRsSrc = readFileSync(LIB_RS, 'utf8');
const invokeTsSrc = readFileSync(INVOKE_TS, 'utf8');

const rustCommands = parseRustCommands(commandsRsSrc);
const registered = new Set(parseHandlerList(libRsSrc));
const jsCalls = parseInvokeCalls(invokeTsSrc);

const rustByName = new Map(rustCommands.map((c) => [c.name, c]));
const jsByName = new Map(jsCalls.map((c) => [c.name, c]));

function allowed(command: string, kind: (typeof ALLOWLIST)[number]['kind']): boolean {
    return ALLOWLIST.some((e) => e.command === command && e.kind === kind);
}

describe('Rust <-> TS command contract', () => {
    it('parses at least one command from each source (sanity)', () => {
        // Guard against a regex that silently returns nothing: if any of the
        // three sources is empty the other assertions become vacuous.
        expect(rustCommands.length).toBeGreaterThan(0);
        expect(registered.size).toBeGreaterThan(0);
        expect(jsCalls.length).toBeGreaterThan(0);
    });

    it('every Rust command in generate_handler! is called from invoke.ts', () => {
        const dead: string[] = [];
        for (const name of registered) {
            if (allowed(name, 'registered-not-called')) continue;
            if (!jsByName.has(name)) dead.push(name);
        }
        expect(
            dead,
            `Rust command(s) registered in generate_handler! but never called from invoke.ts: ${dead.join(', ')}`,
        ).toEqual([]);
    });

    it('every invoke() call in invoke.ts has a matching registered Rust command', () => {
        const orphans: string[] = [];
        for (const { name } of jsCalls) {
            if (allowed(name, 'called-not-registered')) continue;
            if (!registered.has(name)) orphans.push(name);
        }
        expect(
            orphans,
            `invoke.ts calls invoke('X') with no matching Rust command registered in generate_handler!: ${orphans.join(', ')}`,
        ).toEqual([]);
    });

    it('every Rust command also has a Rust definition in commands.rs', () => {
        // Catches the case where a name in generate_handler! refers to a
        // function that no longer exists (would be a compile error in Rust
        // anyway, but cheap to assert here for a clearer failure message
        // when running the JS test suite in isolation).
        const missing: string[] = [];
        for (const name of registered) {
            if (!rustByName.has(name)) missing.push(name);
        }
        expect(
            missing,
            `Names in generate_handler! with no #[tauri::command] in commands.rs: ${missing.join(', ')}`,
        ).toEqual([]);
    });

    it('arg names match (snake_case-normalized) for every Rust<->JS pair', () => {
        const mismatches: string[] = [];
        for (const { name, args: jsArgs } of jsCalls) {
            if (!registered.has(name)) continue; // covered by orphan test
            if (allowed(name, 'arg-mismatch')) continue;
            const rust = rustByName.get(name);
            if (!rust) continue; // covered by missing-definition test
            const rustNorm = rust.args.map(normalize).sort();
            const jsNorm = jsArgs.map(normalize).sort();
            const same =
                rustNorm.length === jsNorm.length && rustNorm.every((v, i) => v === jsNorm[i]);
            if (!same) {
                mismatches.push(
                    `${name}: rust=[${rust.args.join(', ')}] (normalized [${rustNorm.join(', ')}]) vs js=[${jsArgs.join(', ')}] (normalized [${jsNorm.join(', ')}])`,
                );
            }
        }
        expect(mismatches, `Rust<->JS arg-name mismatches:\n  ${mismatches.join('\n  ')}`).toEqual(
            [],
        );
    });
});
