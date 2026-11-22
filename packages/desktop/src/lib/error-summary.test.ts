import { describe, expect, it } from 'vitest';
import { MAX_SUMMARY_LENGTH, summarizeError } from './error-summary';
import { ERR_ACCESSIBILITY_REQUIRED, ERR_MIC_DENIED } from './markers';

describe('summarizeError', () => {
    it('pulls the readable message out of a provider JSON error body', () => {
        const raw =
            'xAI STT request failed: 403 {"code":"The caller does not have permission to execute the specified operation","error":"Your newly created team doesn\'t have any credits or licenses yet. You can purchase those on https://console.x.ai/team/0919dead-d3f2-4d74-92a0-c0fa6909acf3."}';
        expect(summarizeError(raw)).toBe(
            "xAI: Your newly created team doesn't have any credits or licenses yet.",
        );
    });

    it('reads the nested message shape most providers use', () => {
        const raw =
            'Groq STT request failed: 401 {"error":{"message":"Invalid API Key","type":"invalid_request_error"}}';
        expect(summarizeError(raw)).toBe('Groq: Invalid API Key');
    });

    it('keeps the status when the body has nothing readable', () => {
        expect(summarizeError('xAI STT request failed: 500 {"trace":"abc123"}')).toBe(
            'xAI STT request failed: 500',
        );
    });

    it('keeps a request failure that has no body at all', () => {
        expect(summarizeError('xAI STT request failed: 429')).toBe('xAI STT request failed: 429');
    });

    it('drops the machine-readable marker and keeps the first sentence', () => {
        expect(
            summarizeError(
                `${ERR_MIC_DENIED} Microphone access is blocked. Open System Settings → Privacy & Security → Microphone and enable bluemacaw.`,
            ),
        ).toBe('Microphone access is blocked.');
        expect(
            summarizeError(
                `${ERR_ACCESSIBILITY_REQUIRED} inserting text needs Accessibility. Grant bluemacaw in System Settings.`,
            ),
        ).toBe('inserting text needs Accessibility.');
    });

    it('keeps a short message as it is', () => {
        expect(summarizeError('No model selected')).toBe('No model selected');
    });

    it('does not cut a sentence at a dot inside a word or number', () => {
        expect(summarizeError('Model gpt-4o.mini returned 2.5 results')).toBe(
            'Model gpt-4o.mini returned 2.5 results',
        );
    });

    it('collapses whitespace and line breaks', () => {
        expect(summarizeError('  socket   closed\n unexpectedly ')).toBe(
            'socket closed unexpectedly',
        );
    });

    it('truncates a long single sentence with an ellipsis', () => {
        const summary = summarizeError(`assemblyai streaming: ${'very '.repeat(60)}long failure`);
        expect(summary.length).toBe(MAX_SUMMARY_LENGTH);
        expect(summary.endsWith('…')).toBe(true);
    });

    it('never returns an empty summary', () => {
        expect(summarizeError('')).toBe('Something went wrong');
        expect(summarizeError('   ')).toBe('Something went wrong');
    });
});
