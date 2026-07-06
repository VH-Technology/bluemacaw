use std::path::PathBuf;

pub const KNOWN_MODEL_IDS: &[&str] = &[
    "ggml-tiny.en",
    "ggml-base.en",
    "ggml-small.en",
    "ggml-medium.en",
    "ggml-large-v3",
];

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
