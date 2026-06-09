#!/usr/bin/env bun
/**
 * Single-source-of-truth version bumper for bluemacaw.
 *
 * Writes the supplied semver to every place a real version lives:
 *   - packages/desktop/package.json
 *   - packages/desktop/src-tauri/tauri.conf.json
 *   - packages/desktop/src-tauri/Cargo.toml          ([package] version)
 *   - packages/desktop/src-tauri/Cargo.lock          (bluemacaw entry)
 *   - packages/landing/package.json
 *
 * Skips:
 *   - root package.json + packages/infra/package.json — both kept at "0.0.0"
 *     because they're private workspace meta with no published artifact.
 *   - test fixtures that reference "0.1.0" as a hard-coded payload — those
 *     are mock GitHub release responses, not the app's own version.
 *
 * The landing Footer reads its version from packages/landing/package.json
 * at import time (see packages/landing/src/lib/version.ts), so updating
 * that file is all the UI needs.
 *
 * Usage:
 *   bun scripts/bump-version.ts 0.2.0          # bump everything to 0.2.0
 *   bun scripts/bump-version.ts --check 0.2.0  # verify everything is 0.2.0, exit 1 if not
 *   bun scripts/bump-version.ts --check        # verify all files are mutually consistent
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');

interface Target {
    /** Path relative to repo root. */
    path: string;
    /** Human-readable label printed in summaries. */
    label: string;
    /** Read the current version from the file's text. */
    read: (text: string) => string | null;
    /** Return a new text with the version replaced. */
    write: (text: string, next: string) => string;
}

function jsonVersionTarget(path: string, label: string): Target {
    return {
        path,
        label,
        read: (text) => {
            const m = text.match(/"version"\s*:\s*"([^"]+)"/);
            return m ? m[1] : null;
        },
        write: (text, next) => text.replace(/("version"\s*:\s*")([^"]+)(")/, `$1${next}$3`),
    };
}

const TARGETS: Target[] = [
    jsonVersionTarget('packages/desktop/package.json', 'desktop (npm)'),
    jsonVersionTarget('packages/desktop/src-tauri/tauri.conf.json', 'desktop (tauri)'),
    {
        path: 'packages/desktop/src-tauri/Cargo.toml',
        label: 'desktop (cargo)',
        // Only match the version under [package], not nested [dependencies].* entries.
        read: (text) => {
            const pkgBlock = text.match(/\[package\][\s\S]*?(?=\n\[|\n*$)/);
            if (!pkgBlock) return null;
            const m = pkgBlock[0].match(/^version\s*=\s*"([^"]+)"/m);
            return m ? m[1] : null;
        },
        write: (text, next) => {
            const pkgBlock = text.match(/\[package\][\s\S]*?(?=\n\[|\n*$)/);
            if (!pkgBlock) throw new Error('Cargo.toml has no [package] section');
            const rewritten = pkgBlock[0].replace(/^(version\s*=\s*")([^"]+)(")/m, `$1${next}$3`);
            return text.replace(pkgBlock[0], rewritten);
        },
    },
    {
        path: 'packages/desktop/src-tauri/Cargo.lock',
        label: 'desktop (cargo.lock)',
        read: (text) => {
            const m = text.match(/name = "bluemacaw"\r?\nversion = "([^"]+)"/);
            return m ? m[1] : null;
        },
        write: (text, next) =>
            text.replace(/(name = "bluemacaw"\r?\nversion = ")([^"]+)(")/, `$1${next}$3`),
    },
    jsonVersionTarget('packages/landing/package.json', 'landing (npm)'),
];

function semverValid(v: string): boolean {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v);
}

interface CurrentState {
    target: Target;
    abs: string;
    text: string;
    current: string | null;
}

function loadAll(): CurrentState[] {
    return TARGETS.map((target) => {
        const abs = resolve(REPO_ROOT, target.path);
        const text = readFileSync(abs, 'utf8');
        const current = target.read(text);
        return { target, abs, text, current };
    });
}

function printRow(label: string, version: string | null, marker = '') {
    const v = version ?? '(not found)';
    console.log(`  ${marker.padEnd(2)} ${label.padEnd(24)} ${v}`);
}

function runBump(next: string): number {
    if (!semverValid(next)) {
        console.error(`error: "${next}" is not a valid semver`);
        return 1;
    }
    const states = loadAll();
    console.log(`Bumping all version sources to ${next}:\n`);
    let changed = 0;
    let alreadyAtTarget = 0;
    for (const s of states) {
        if (s.current === next) {
            printRow(s.target.label, s.current, '=');
            alreadyAtTarget++;
            continue;
        }
        const before = s.current ?? '(none)';
        const newText = s.target.write(s.text, next);
        if (newText === s.text) {
            console.error(`\nerror: ${s.target.path} — write produced no change (regex miss?)`);
            return 2;
        }
        writeFileSync(s.abs, newText);
        printRow(s.target.label, `${before} → ${next}`, '✓');
        changed++;
    }
    console.log(`\n${changed} file(s) updated, ${alreadyAtTarget} already at ${next}.`);
    if (changed > 0) {
        console.log('\nNext: `git diff` to review, then commit with the conventional prefix:');
        console.log(`  git commit -am "chore: bump version to ${next}"`);
    }
    return 0;
}

function runCheck(expected?: string): number {
    const states = loadAll();
    console.log(
        expected
            ? `Verifying all version sources are ${expected}:\n`
            : 'Verifying all version sources agree:\n',
    );
    const versions = new Set<string>();
    let failed = false;
    for (const s of states) {
        const ok = expected ? s.current === expected : true;
        printRow(s.target.label, s.current, ok ? '✓' : '✗');
        if (s.current) versions.add(s.current);
        if (!ok) failed = true;
    }
    if (!expected && versions.size > 1) {
        console.error(`\nerror: versions disagree across files: ${[...versions].join(', ')}`);
        return 3;
    }
    if (failed) return 1;
    console.log('\nAll consistent.');
    return 0;
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log(
        [
            'Usage:',
            '  bun scripts/bump-version.ts <semver>           Bump all version sources to <semver>.',
            '  bun scripts/bump-version.ts --check            Verify all version sources agree.',
            '  bun scripts/bump-version.ts --check <semver>   Verify all version sources equal <semver>.',
        ].join('\n'),
    );
    process.exit(0);
}

const checkIdx = args.indexOf('--check');
if (checkIdx >= 0) {
    const expected = args.find((a, i) => i !== checkIdx && !a.startsWith('--'));
    process.exit(runCheck(expected));
}

const next = args.find((a) => !a.startsWith('--'));
if (!next) {
    console.error('error: missing version argument. Use --help for usage.');
    process.exit(1);
}
process.exit(runBump(next));
