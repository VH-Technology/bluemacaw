//! Stateful mono i16 PCM resampler that converts an arbitrary source rate to
//! [`TARGET_RATE`] (16 kHz — the rate expected by every streaming STT
//! provider we currently target).
//!
//! Uses nearest-neighbor sample selection driven by integer arithmetic, so
//! the output is bit-identical regardless of how the input is chunked: feed
//! N samples in one call or split them across many calls and the
//! concatenated output is the same. That matters for streaming: the cpal
//! callback hands us short, variable-length buffers, but the WebSocket on
//! the other end expects a continuous stream.
//!
//! Nearest-neighbor introduces some aliasing vs. a properly band-limited
//! polyphase resampler. ASR models tolerate this in practice; revisit if a
//! provider shows accuracy regressions traceable to resampling.

const TARGET_RATE: u32 = 16_000;

/// Streaming resampler. Persist one instance per capture session and call
/// [`process`](Resampler::process) once per chunk; the accumulated state
/// keeps successive chunks phase-aligned with each other.
pub struct Resampler {
    src_rate: u32,
    /// Number of input samples we've consumed across all `process` calls.
    /// Combined with `output_count` this defines, for each output sample,
    /// which absolute input index to pick.
    total_input_consumed: u64,
    /// Number of output samples we've emitted across all `process` calls.
    output_count: u64,
}

impl Resampler {
    pub fn new(src_rate: u32) -> Self {
        Self {
            src_rate,
            total_input_consumed: 0,
            output_count: 0,
        }
    }

    pub fn target_rate() -> u32 {
        TARGET_RATE
    }

    /// Resamples `input` to 16 kHz and returns the produced samples. The
    /// number of samples returned depends on `src_rate` and how much of a
    /// previous chunk's fractional position carries over.
    pub fn process(&mut self, input: &[i16]) -> Vec<i16> {
        if self.src_rate == TARGET_RATE {
            self.total_input_consumed += input.len() as u64;
            self.output_count += input.len() as u64;
            return input.to_vec();
        }
        if input.is_empty() {
            return Vec::new();
        }
        let chunk_end_abs = self.total_input_consumed + input.len() as u64;
        let mut out = Vec::new();
        loop {
            // Source position (absolute, across all chunks) for the next
            // output sample. output_index * src_rate / TARGET_RATE gives the
            // nearest source-sample index for the chosen output time.
            let src_abs = (self.output_count * self.src_rate as u64) / TARGET_RATE as u64;
            if src_abs >= chunk_end_abs {
                // The next output sample lands beyond what we have so far;
                // it'll be produced by a future chunk.
                break;
            }
            let local_idx = (src_abs - self.total_input_consumed) as usize;
            out.push(input[local_idx]);
            self.output_count += 1;
        }
        self.total_input_consumed = chunk_end_abs;
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passthrough_at_target_rate() {
        let mut r = Resampler::new(16_000);
        let out = r.process(&[1, 2, 3, 4]);
        assert_eq!(out, vec![1, 2, 3, 4]);
    }

    #[test]
    fn passthrough_preserves_state_across_chunks() {
        let mut r = Resampler::new(16_000);
        let a = r.process(&[1, 2, 3]);
        let b = r.process(&[4, 5, 6]);
        assert_eq!(a, vec![1, 2, 3]);
        assert_eq!(b, vec![4, 5, 6]);
    }

    #[test]
    fn decimates_48k_to_16k_three_to_one() {
        let mut r = Resampler::new(48_000);
        let input: Vec<i16> = (0..30).collect();
        let out = r.process(&input);
        // 30 samples at 48 kHz is 30/48000 s; at 16 kHz that's 10 samples.
        assert_eq!(out, vec![0, 3, 6, 9, 12, 15, 18, 21, 24, 27]);
    }

    #[test]
    fn handles_44100_to_16000_fractional_ratio() {
        let mut r = Resampler::new(44_100);
        // 1 second of input at 44.1 kHz → exactly 16 000 output samples.
        let input: Vec<i16> = vec![0; 44_100];
        let out = r.process(&input);
        assert_eq!(out.len(), 16_000);
    }

    #[test]
    fn produces_same_output_whether_split_or_monolithic() {
        // Phase continuity across chunk boundaries is the load-bearing
        // contract for streaming: the WebSocket on the other end can't
        // tell where one chunk ended and the next began.
        let mut split = Resampler::new(48_000);
        let chunk1: Vec<i16> = (0..15).collect();
        let chunk2: Vec<i16> = (15..30).collect();
        let mut combined_split = split.process(&chunk1);
        combined_split.extend(split.process(&chunk2));

        let mut monolithic = Resampler::new(48_000);
        let combined_monolithic = monolithic.process(&(0..30).collect::<Vec<i16>>());

        assert_eq!(combined_split, combined_monolithic);
    }

    #[test]
    fn empty_input_produces_no_output() {
        let mut r = Resampler::new(48_000);
        assert!(r.process(&[]).is_empty());
    }

    #[test]
    fn variable_chunk_sizes_preserve_phase() {
        // The cpal callback hands us variable-sized buffers; the resampler
        // must track its phase across them. Feed 2-sample chunks at 48 kHz
        // (3:1 decimation): output samples land at absolute indices 0, 3,
        // 6, ..., so only every other chunk produces a sample.
        let mut r = Resampler::new(48_000);
        // chunk 0: samples 0..2 — index 0 is in range, emit input[0]=10.
        // Next needed index is 3, not yet available.
        assert_eq!(r.process(&[10, 20]), vec![10]);
        // chunk 1: samples 2..4 — index 3 is now in range, emit input[1]=40.
        assert_eq!(r.process(&[30, 40]), vec![40]);
        // chunk 2: samples 4..6 — next needed index is 6, just past the end.
        assert!(r.process(&[50, 60]).is_empty());
        // chunk 3: samples 6..8 — index 6 is now in range, emit input[0]=70.
        assert_eq!(r.process(&[70, 80]), vec![70]);
    }

    #[test]
    fn target_rate_is_16k() {
        // Pin the constant — the streaming-STT providers we target (ElevenLabs
        // Scribe v2 Realtime, Deepgram Nova-3 streaming) all expect 16 kHz
        // mono PCM. Changing this value will desync the WebSocket feed.
        assert_eq!(Resampler::target_rate(), 16_000);
    }
}
