import {
    ERR_ACCESSIBILITY_REQUIRED,
    ERR_INPUT_MONITORING_REQUIRED,
    ERR_MIC_DENIED,
    ERR_WAYLAND_PASTE_UNSUPPORTED,
} from './markers';

/** Longest summary the floating pill can show in its three lines. */
export const MAX_SUMMARY_LENGTH = 110;

const MARKERS = [
    ERR_ACCESSIBILITY_REQUIRED,
    ERR_INPUT_MONITORING_REQUIRED,
    ERR_MIC_DENIED,
    ERR_WAYLAND_PASTE_UNSUPPORTED,
];

function asText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The human-readable field of a provider's JSON error body, if it has one. */
function readableField(body: unknown): string | null {
    if (typeof body !== 'object' || body === null) return null;
    const record = body as Record<string, unknown>;
    const nested =
        typeof record.error === 'object' && record.error !== null
            ? asText((record.error as Record<string, unknown>).message)
            : null;
    return (
        asText(record.error) ??
        nested ??
        asText(record.message) ??
        asText(record.detail) ??
        asText(record.error_description)
    );
}

/**
 * Split "`<head>` `<json body>`" into the readable part of the body and the
 * text in front of it. Returns null when the message carries no JSON object.
 */
function splitJsonBody(message: string): { head: string; readable: string | null } | null {
    const start = message.indexOf('{');
    if (start === -1) return null;
    try {
        const body: unknown = JSON.parse(message.slice(start));
        return { head: message.slice(0, start).trim(), readable: readableField(body) };
    } catch {
        return null;
    }
}

/** Up to and including the first sentence end that is followed by a space. */
function firstSentence(text: string): string {
    const match = /^.*?[.!?](?=\s)/.exec(text);
    return match ? match[0] : text;
}

function truncate(text: string): string {
    if (text.length <= MAX_SUMMARY_LENGTH) return text;
    return `${text.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd()}…`;
}

/**
 * Shorten an error message to what fits on the floating pill.
 *
 * Errors reach the pill as raw strings: a provider's HTTP status and JSON
 * body, or one of our own messages with a machine-readable marker and
 * several sentences of instructions. The pill has room for about one
 * sentence, so this keeps who failed and why; the main window still shows
 * the full message.
 */
export function summarizeError(message: string): string {
    let text = message.replace(/\s+/g, ' ').trim();
    for (const marker of MARKERS) {
        if (text.startsWith(marker)) text = text.slice(marker.length).trim();
    }
    const json = splitJsonBody(text);
    if (json) {
        // "xAI STT request failed: 403" → "xAI"
        const provider = /^(.+?)\s+(?:STT\s+)?request failed\b/i.exec(json.head)?.[1];
        if (json.readable) {
            const readable = firstSentence(json.readable);
            text = provider ? `${provider}: ${readable}` : readable;
        } else {
            text = json.head;
        }
    } else {
        text = firstSentence(text);
    }
    return truncate(text) || 'Something went wrong';
}
