use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub mod microphone;
pub mod permissions;
pub mod resampler;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionState {
    Granted,
    Denied,
    NotDetermined,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub id: String,
    pub label: String,
    pub is_default: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("microphone permission not granted")]
    PermissionDenied,
    #[error("audio device unavailable: {0}")]
    DeviceUnavailable(String),
    #[error("capture failed: {0}")]
    CaptureFailed(String),
}

pub struct CaptureSession {
    pub id: Uuid,
}

/// Callback fired with each chunk of 16 kHz mono i16 PCM produced during a
/// realtime capture session. First argument is the session's
/// [`Uuid`](uuid::Uuid) so a single global Tauri event can carry chunks
/// for any active session. Invoked on a dedicated emitter thread — *not*
/// the cpal real-time audio thread — so a slow callback won't tear down
/// CoreAudio, though it will eventually back-pressure the audio buffer.
pub type RealtimeChunkCallback = Box<dyn Fn(Uuid, &[i16]) + Send + Sync>;

pub trait AudioSource: Send + Sync {
    fn check_permission(&self) -> PermissionState;
    fn request_permission(&self) -> Result<PermissionState, AudioError>;
    fn start_capture(&self) -> Result<CaptureSession, AudioError> {
        self.start_capture_with_device(None)
    }
    fn start_capture_with_device(
        &self,
        device_id: Option<&str>,
    ) -> Result<CaptureSession, AudioError>;
    /// Begin capture in realtime mode: audio is still buffered as in
    /// `start_capture_with_device` (so `stop_capture` continues to return
    /// the full WAV), AND `on_chunk` is invoked off-thread with 16 kHz mono
    /// i16 PCM frames as they arrive. Used by the streaming-STT pipeline.
    ///
    /// Default impl returns an unsupported error so mock/test sources don't
    /// have to opt in. Real impls override this with a cpal-driven path.
    fn start_capture_realtime(
        &self,
        device_id: Option<&str>,
        on_chunk: RealtimeChunkCallback,
    ) -> Result<CaptureSession, AudioError> {
        let _ = (device_id, on_chunk);
        Err(AudioError::CaptureFailed(
            "realtime capture not supported by this audio source".into(),
        ))
    }
    fn stop_capture(&self, session: &CaptureSession) -> Result<Vec<u8>, AudioError>;
    /// Like `stop_capture` but discards the buffered audio instead of
    /// returning WAV bytes. Used by the cancel-recording path so an aborted
    /// session never reaches an STT provider. Default impl falls back to
    /// calling `stop_capture` and dropping the result so mock impls don't
    /// have to implement this explicitly.
    fn cancel_capture(&self, session: &CaptureSession) -> Result<(), AudioError> {
        self.stop_capture(session).map(|_| ())
    }
    /// Returns the loudest sample observed for `session` since the last call,
    /// normalized to 0.0..=1.0, and resets the tracked peak to 0.0. Returns
    /// `None` when the source doesn't support level metering or the session
    /// is unknown. Default impl returns None so mock/test sources don't need
    /// to bother.
    fn peak_level(&self, _session: &CaptureSession) -> Option<f32> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_state_serializes() {
        let json = serde_json::to_string(&PermissionState::Granted).unwrap();
        assert_eq!(json, "\"Granted\"");
    }

    #[test]
    fn permission_state_deserializes() {
        let s: PermissionState = serde_json::from_str("\"Denied\"").unwrap();
        assert_eq!(s, PermissionState::Denied);
    }
}
