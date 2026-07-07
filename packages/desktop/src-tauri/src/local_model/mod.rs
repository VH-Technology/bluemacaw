use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::audio::resampler::Resampler;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub const KNOWN_MODEL_IDS: &[&str] = &[
    "ggml-tiny.en",
    "ggml-base.en",
    "ggml-small.en",
    "ggml-medium.en",
    "ggml-large-v3",
];

static CONTEXTS: once_cell::sync::Lazy<
    Mutex<std::collections::HashMap<String, WhisperContext>>,
> = once_cell::sync::Lazy::new(|| Mutex::new(std::collections::HashMap::new()));

pub fn model_download_url(model_id: &str) -> Option<String> {
    if !KNOWN_MODEL_IDS.contains(&model_id) {
        return None;
    }
    Some(format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}.bin",
        model_id
    ))
}

pub fn model_dir(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join("models")
}

pub fn model_path(app_data_dir: &std::path::Path, model_id: &str) -> PathBuf {
    model_dir(app_data_dir).join(format!("{}.gguf", model_id))
}

pub fn transcribe_wav_file(model_path: &Path, wav_bytes: &[u8]) -> Result<String, String> {
    let path_str = model_path.to_string_lossy().to_string();

    let ctx = {
        let mut cache = CONTEXTS.lock().map_err(|e| e.to_string())?;
        if !cache.contains_key(&path_str) {
            let params = WhisperContextParameters::default();
            let ctx = WhisperContext::new_with_params(&path_str, params)
                .map_err(|e| format!("Failed to load whisper model: {e}"))?;
            cache.insert(path_str.clone(), ctx);
        }
        cache.get(&path_str).unwrap() as *const WhisperContext
    };

    let mut cursor = std::io::Cursor::new(wav_bytes);
    let reader =
        hound::WavReader::new(&mut cursor).map_err(|e| format!("Failed to read WAV: {e}"))?;
    let spec = reader.spec();
    let sample_rate = spec.sample_rate;
    let samples: Vec<i16> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .into_samples::<i16>()
            .filter_map(|s| s.ok())
            .collect(),
        hound::SampleFormat::Float => reader
            .into_samples::<f32>()
            .filter_map(|s| s.ok())
            .map(|s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
            .collect(),
    };

    let n_channels = spec.channels as usize;

    let mono_i16: Vec<i16> = if n_channels > 1 {
        (0..samples.len() / n_channels)
            .map(|i| {
                let mut acc: i32 = 0;
                for c in 0..n_channels {
                    acc += samples[i * n_channels + c] as i32;
                }
                let avg = acc / n_channels as i32;
                avg.clamp(i16::MIN as i32, i16::MAX as i32) as i16
            })
            .collect()
    } else {
        samples
    };

    let mono_samples_i16 = if sample_rate == Resampler::target_rate() {
        mono_i16
    } else {
        let mut resampler = Resampler::new(sample_rate);
        resampler.process(&mono_i16)
    };

    let mono_samples: Vec<f32> = mono_samples_i16
        .iter()
        .map(|s| *s as f32 / 32768.0)
        .collect();

    let ctx = unsafe { &*ctx };
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create state: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(num_cpus::get() as i32);
    params.set_language(Some("en"));
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_single_segment(true);

    state
        .full(params, &mono_samples)
        .map_err(|e| format!("Transcription failed: {e}"))?;

    let num_segments = state.full_n_segments();

    let mut text = String::new();
    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            text.push_str(&segment.to_string());
        }
    }

    Ok(text.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_model_ids_have_urls() {
        for id in KNOWN_MODEL_IDS {
            assert!(model_download_url(id).is_some());
        }
    }

    #[test]
    fn unknown_model_id_returns_none() {
        assert!(model_download_url("nonexistent-model").is_none());
    }

    #[test]
    fn model_path_uses_gguf_extension() {
        let dir = std::path::Path::new("/tmp/bluemacaw");
        assert_eq!(
            model_path(dir, "ggml-tiny.en"),
            PathBuf::from("/tmp/bluemacaw/models/ggml-tiny.en.gguf")
        );
    }
}
