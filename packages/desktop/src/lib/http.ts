import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/**
 * A `fetch` that routes through Tauri's HTTP plugin (the request is made
 * from the Rust process), bypassing the webview's CORS enforcement.
 *
 * Why this exists: some provider APIs — notably Deepgram's `/v1/listen` —
 * don't return `Access-Control-Allow-Origin` for the webview origin, so a
 * browser `fetch` dies at the CORS preflight (the request shows no status /
 * no response headers in devtools). Making the call from Rust sidesteps CORS
 * entirely.
 *
 * Outside a Tauri runtime (vitest's node env, SSR, plain browser) it falls
 * back to the global `fetch` so MSW-based unit tests and non-Tauri callers
 * keep working unchanged.
 */
export const httpFetch: typeof globalThis.fetch = (input, init) => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (inTauri) {
        // Tauri's fetch is a drop-in for the web Fetch API (supports method,
        // headers, binary body, and AbortSignal), so the cast is safe.
        return tauriFetch(input as Parameters<typeof tauriFetch>[0], init);
    }
    return globalThis.fetch(input, init);
};
