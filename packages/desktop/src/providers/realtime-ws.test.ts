// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toTauriPayload } from './realtime-ws';

describe('toTauriPayload', () => {
    it('passes strings through unchanged as text frames', () => {
        expect(toTauriPayload('{"hello":"world"}')).toBe('{"hello":"world"}');
    });

    it('converts an Int16Array (typed-array view) to a byte number[]', () => {
        // 2 i16 samples little-endian: 1 -> [0x01,0x00], 2 -> [0x02,0x00]
        const pcm = new Int16Array([1, 2]);
        expect(toTauriPayload(pcm)).toEqual([1, 0, 2, 0]);
    });

    it('honors byteOffset on a subarray view (no leading bytes leak in)', () => {
        const full = new Int16Array([9, 1, 2]);
        const view = full.subarray(1); // [1, 2], offset 2 bytes into the buffer
        expect(toTauriPayload(view)).toEqual([1, 0, 2, 0]);
    });

    it('converts a raw ArrayBuffer to a byte number[]', () => {
        const buf = new Uint8Array([0xde, 0xad, 0xbe, 0xef]).buffer;
        expect(toTauriPayload(buf)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    });
});
