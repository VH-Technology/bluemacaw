/**
 * One piece of a transcript, plus the whitespace that followed it in the
 * original text (`''` for the last piece). Joining every `text + gap` in order
 * reproduces the transcript.
 */
export interface TranscriptPiece {
    text: string;
    gap: string;
}

export interface SplitOptions {
    /** Transcripts up to this many words are never split. */
    splitAbove: number;
    /** Sentences are grouped into pieces of at most this many words. */
    maxWords: number;
}

/**
 * Tuned against Apple's on-device model on macOS 27 (about 45 words a
 * second). A punctuated transcript of 270 words cleans up fine in one
 * request; an 800-word one takes 18 s of the 30 s budget and gets sloppier
 * towards the end. Pieces of 150 words stay well inside the budget and the
 * context window. Pieces of 30 to 45 words were worse: more seams, and the
 * model occasionally changed the meaning of a sentence it saw out of context.
 */
export const DEFAULT_SPLIT_OPTIONS: SplitOptions = { splitAbove: 200, maxWords: 150 };

// Sentence-ending punctuation, any closing quotes or brackets, then the
// whitespace that follows. Requiring whitespace keeps "1.2.0" in one piece.
// (No lookbehind: the webview on macOS 10.15 can't parse it.)
const SENTENCE_BREAK = /([.!?…]+["'”’)\]]*)(\s+)/g;

function countWords(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
}

function splitSentences(text: string): TranscriptPiece[] {
    const sentences: TranscriptPiece[] = [];
    let start = 0;
    for (const match of text.matchAll(SENTENCE_BREAK)) {
        const [, ending = '', gap = ''] = match;
        const end = (match.index ?? 0) + ending.length;
        sentences.push({ text: text.slice(start, end), gap });
        start = end + gap.length;
    }
    if (start < text.length) sentences.push({ text: text.slice(start), gap: '' });
    return sentences;
}

/**
 * Split a long transcript into groups of whole sentences so each group can be
 * cleaned up on its own. Cuts fall only on sentence breaks: a transcript with
 * no sentence punctuation comes back whole, because cutting it at arbitrary
 * words makes the model capitalize and punctuate the seams.
 */
export function splitTranscript(
    text: string,
    options: SplitOptions = DEFAULT_SPLIT_OPTIONS,
): TranscriptPiece[] {
    const whole = [{ text, gap: '' }];
    if (countWords(text) <= options.splitAbove) return whole;
    const sentences = splitSentences(text);
    if (sentences.length < 2) return whole;

    const pieces: TranscriptPiece[] = [];
    let current: TranscriptPiece | null = null;
    let currentWords = 0;
    for (const sentence of sentences) {
        const words = countWords(sentence.text);
        if (current && currentWords + words <= options.maxWords) {
            current = { text: current.text + current.gap + sentence.text, gap: sentence.gap };
            currentWords += words;
            continue;
        }
        if (current) pieces.push(current);
        current = sentence;
        currentWords = words;
    }
    if (current) pieces.push(current);
    return pieces;
}
