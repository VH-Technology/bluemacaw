import { describe, expect, it } from 'vitest';
import { splitTranscript } from './split-transcript';

// Small limits keep the fixtures readable: split above 8 words, 6 words a piece.
const options = { splitAbove: 8, maxWords: 6 };

describe('splitTranscript', () => {
    it('keeps a short transcript whole', () => {
        expect(splitTranscript('One two three. Four five six.', options)).toEqual([
            { text: 'One two three. Four five six.', gap: '' },
        ]);
    });

    it('keeps a long transcript without sentence punctuation whole', () => {
        const runOn = 'one two three four five six seven eight nine ten';

        expect(splitTranscript(runOn, options)).toEqual([{ text: runOn, gap: '' }]);
    });

    it('splits a long transcript at sentence breaks, filling pieces up to the word limit', () => {
        expect(
            splitTranscript(
                'One two three. Four five six. Seven eight nine. Ten eleven twelve.',
                options,
            ),
        ).toEqual([
            { text: 'One two three. Four five six.', gap: ' ' },
            { text: 'Seven eight nine. Ten eleven twelve.', gap: '' },
        ]);
    });

    it('never cuts inside a sentence, even one longer than the word limit', () => {
        expect(
            splitTranscript('One two three four five six seven eight. Nine ten.', options),
        ).toEqual([
            { text: 'One two three four five six seven eight.', gap: ' ' },
            { text: 'Nine ten.', gap: '' },
        ]);
    });

    it('treats question and exclamation marks as sentence breaks', () => {
        expect(
            splitTranscript(
                'Is one two three four? Yes five six seven! Then eight nine ten.',
                options,
            ),
        ).toEqual([
            { text: 'Is one two three four?', gap: ' ' },
            { text: 'Yes five six seven!', gap: ' ' },
            { text: 'Then eight nine ten.', gap: '' },
        ]);
    });

    it('does not break at dots inside numbers and versions', () => {
        expect(
            splitTranscript('Bump version 1.2.0 to 1.2.1 today please now. Then ship it.', options),
        ).toEqual([
            { text: 'Bump version 1.2.0 to 1.2.1 today please now.', gap: ' ' },
            { text: 'Then ship it.', gap: '' },
        ]);
    });

    it('keeps the original whitespace between pieces', () => {
        expect(
            splitTranscript('One two three four five.\n\nSix seven eight nine ten.', options),
        ).toEqual([
            { text: 'One two three four five.', gap: '\n\n' },
            { text: 'Six seven eight nine ten.', gap: '' },
        ]);
    });

    it('keeps a closing quote with its sentence', () => {
        expect(
            splitTranscript(
                'He said "one two three four." Then five six seven eight nine.',
                options,
            ),
        ).toEqual([
            { text: 'He said "one two three four."', gap: ' ' },
            { text: 'Then five six seven eight nine.', gap: '' },
        ]);
    });

    it('carries trailing whitespace as the last gap', () => {
        expect(
            splitTranscript('One two three four five. Six seven eight nine ten. ', options),
        ).toEqual([
            { text: 'One two three four five.', gap: ' ' },
            { text: 'Six seven eight nine ten.', gap: ' ' },
        ]);
    });
});
