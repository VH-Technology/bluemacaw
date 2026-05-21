use super::{AudioError, AudioSource, CaptureSession, PermissionState, RealtimeChunkCallback};
use crate::audio::resampler::Resampler;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::SampleFormat;
use std::io::{Cursor, Write};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use uuid::Uuid;

/// Lock a mutex from inside the cpal real-time audio callback. If another
/// thread panicked while holding the lock, the mutex is poisoned — but the
/// audio thread must NOT propagate that panic (it would tear down CoreAudio
/// on macOS and kill capture for the whole app). Recover the inner value
/// and keep streaming; the worst case is one stale sample buffer or peak
/// reading, which is preferable to losing audio.
fn lock_or_recover<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    match m.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// `cpal::Stream` is intentionally `!Send + !Sync` on every platform (on macOS
/// it owns CoreAudio property listeners that must stay on the thread that
/// created them). To satisfy `AudioSource: Send + Sync`, we keep each stream
/// confined to a dedicated worker thread and communicate with it through a
/// stop channel + a shared sample buffer.
pub struct MicrophoneSource {
    sessions: Arc<Mutex<Vec<ActiveSession>>>,
}

struct ActiveSession {
    id: Uuid,
    samples: Arc<Mutex<Vec<i16>>>,
    sample_rate: u32,
    /// Peak amplitude (0.0..=1.0) observed since the last `peak_level_for`
    /// call. Updated from the cpal callback after downmixing to mono so the
    /// displayed level matches the saved audio.
    peak_level: Arc<Mutex<f32>>,
    stop_tx: mpsc::Sender<()>,
    worker: Option<JoinHandle<()>>,
    /// Emitter thread spawned by realtime capture sessions. It consumes the
    /// chunk channel set up alongside the cpal stream, resamples to 16 kHz,
    /// and invokes the caller's `on_chunk` callback. `None` for batch-only
    /// sessions. Joined alongside `worker` on shutdown.
    rt_emitter: Option<JoinHandle<()>>,
}

impl MicrophoneSource {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Read the current peak amplitude for `session_id` and reset it to 0.0.
    /// Returns `None` if no such session is active. The reset gives
    /// poll-and-clear semantics so each UI frame measures only the loudest
    /// sample since the previous poll — otherwise the meter would saturate.
    pub fn peak_level_for(&self, session_id: Uuid) -> Option<f32> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.iter().find(|s| s.id == session_id)?;
        let mut peak = session.peak_level.lock().unwrap();
        let current = *peak;
        *peak = 0.0;
        Some(current)
    }

    pub fn list_devices() -> Result<Vec<crate::audio::AudioDeviceInfo>, AudioError> {
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        let default_name = host
            .default_input_device()
            .and_then(|d| d.name().ok());
        let devices = host
            .input_devices()
            .map_err(|e| AudioError::DeviceUnavailable(e.to_string()))?;
        let mut out = Vec::new();
        for d in devices {
            if let Ok(name) = d.name() {
                let is_default = default_name.as_deref() == Some(name.as_str());
                out.push(crate::audio::AudioDeviceInfo {
                    id: name.clone(),
                    label: name,
                    is_default,
                });
            }
        }
        Ok(out)
    }
}

impl Default for MicrophoneSource {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioSource for MicrophoneSource {
    fn check_permission(&self) -> PermissionState {
        super::permissions::check_microphone_permission()
    }

    fn request_permission(&self) -> Result<PermissionState, AudioError> {
        super::permissions::request_microphone_permission()
    }

    fn start_capture_with_device(
        &self,
        device_id: Option<&str>,
    ) -> Result<CaptureSession, AudioError> {
        self.start_capture_inner(device_id, None).map(|(s, _)| s)
    }

    fn start_capture_realtime(
        &self,
        device_id: Option<&str>,
        on_chunk: RealtimeChunkCallback,
    ) -> Result<CaptureSession, AudioError> {
        // The cpal callback runs at real-time priority — anything that
        // resamples or invokes user code must happen off-thread. Bridge
        // them with an mpsc channel: callback enqueues raw mono i16 at the
        // device's native rate; emitter thread resamples to 16 kHz and
        // invokes the user callback.
        let (chunk_tx, chunk_rx) = mpsc::channel::<Vec<i16>>();
        let (session, sample_rate) = self.start_capture_inner(device_id, Some(chunk_tx))?;
        let session_id = session.id;

        let emitter = thread::Builder::new()
            .name(format!("bluemacaw-rt-emit-{}", session.id))
            .spawn(move || {
                let mut resampler = Resampler::new(sample_rate);
                while let Ok(chunk) = chunk_rx.recv() {
                    let resampled = resampler.process(&chunk);
                    if !resampled.is_empty() {
                        on_chunk(session_id, &resampled);
                    }
                }
            })
            .map_err(|e| AudioError::CaptureFailed(format!("failed to spawn emitter: {e}")))?;

        // Attach the emitter to the session so it gets joined on shutdown.
        {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(s) = sessions.iter_mut().find(|s| s.id == session.id) {
                s.rt_emitter = Some(emitter);
            }
        }
        Ok(session)
    }

    fn peak_level(&self, session: &CaptureSession) -> Option<f32> {
        self.peak_level_for(session.id)
    }

    fn stop_capture(&self, session: &CaptureSession) -> Result<Vec<u8>, AudioError> {
        let mut active = self.take_session(session.id)?;
        let _ = active.stop_tx.send(());
        if let Some(handle) = active.worker.take() {
            let _ = handle.join();
        }
        // Worker drop closes the chunk channel (it owned the only Sender
        // clone via the cpal callback), so the emitter thread exits on its
        // own next recv(). Join it for tidy shutdown.
        if let Some(handle) = active.rt_emitter.take() {
            let _ = handle.join();
        }
        let samples = active.samples.lock().unwrap().clone();
        Ok(encode_wav_pcm16(&samples, active.sample_rate))
    }

    fn cancel_capture(&self, session: &CaptureSession) -> Result<(), AudioError> {
        // Mirror `stop_capture` for the side-effect of shutting down the
        // cpal worker — but never touch the samples buffer. The session is
        // simply dropped, and so is the buffer along with it.
        let mut active = self.take_session(session.id)?;
        let _ = active.stop_tx.send(());
        if let Some(handle) = active.worker.take() {
            let _ = handle.join();
        }
        if let Some(handle) = active.rt_emitter.take() {
            let _ = handle.join();
        }
        Ok(())
    }
}

impl MicrophoneSource {
    /// Shared body of [`AudioSource::start_capture_with_device`] and
    /// [`AudioSource::start_capture_realtime`]. When `chunk_tx` is `Some`,
    /// the cpal callback also forwards each mono i16 buffer to that channel
    /// so a downstream thread can resample and stream it; when `None`, the
    /// realtime branch is skipped entirely and behaviour is identical to
    /// the original batch path.
    fn start_capture_inner(
        &self,
        device_id: Option<&str>,
        chunk_tx: Option<mpsc::Sender<Vec<i16>>>,
    ) -> Result<(CaptureSession, u32), AudioError> {
        let id = Uuid::new_v4();
        let samples: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::new()));
        let samples_for_worker = samples.clone();
        let peak_level: Arc<Mutex<f32>> = Arc::new(Mutex::new(0.0));
        let peak_for_worker = peak_level.clone();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        // Channel used by the worker to report startup success/failure and the
        // negotiated sample rate before it parks waiting for `stop_rx`.
        let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, AudioError>>();

        let device_id_owned: Option<String> = device_id.map(str::to_string);
        let chunk_tx_for_worker = chunk_tx;
        let worker = thread::Builder::new()
            .name(format!("bluemacaw-mic-{id}"))
            .spawn(move || {
                let host = cpal::default_host();
                let device = match device_id_owned.as_deref() {
                    None => match host.default_input_device() {
                        Some(d) => d,
                        None => {
                            let _ = ready_tx.send(Err(AudioError::DeviceUnavailable(
                                "system default".into(),
                            )));
                            return;
                        }
                    },
                    Some(name) => {
                        let mut devices = match host.input_devices() {
                            Ok(d) => d,
                            Err(e) => {
                                let _ = ready_tx.send(Err(AudioError::DeviceUnavailable(
                                    e.to_string(),
                                )));
                                return;
                            }
                        };
                        let found =
                            devices.find(|d| d.name().map(|n| n == name).unwrap_or(false));
                        match found {
                            Some(d) => d,
                            None => {
                                let _ = ready_tx.send(Err(AudioError::DeviceUnavailable(
                                    name.to_string(),
                                )));
                                return;
                            }
                        }
                    }
                };
                let config = match device.default_input_config() {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = ready_tx.send(Err(AudioError::CaptureFailed(e.to_string())));
                        return;
                    }
                };
                let sample_rate = config.sample_rate().0;
                let channels = config.channels() as usize;
                let sample_format = config.sample_format();
                let stream_config: cpal::StreamConfig = config.into();
                let err_fn = |err| log::error!("cpal stream error: {err}");
                let samples_clone = samples_for_worker.clone();
                let peak_clone_f32 = peak_for_worker.clone();
                let peak_clone_i16 = peak_for_worker.clone();
                // Separate Option<Sender> clones per branch — only one
                // build_input_stream arm actually runs (sample_format
                // decides), so duplicating the clone is harmless and keeps
                // each closure self-contained.
                let chunk_tx_f32 = chunk_tx_for_worker.clone();
                let chunk_tx_i16 = chunk_tx_for_worker.clone();
                // Downmix any multichannel input to mono. Built-in mics on
                // macOS often default to stereo at 48 kHz; tagging the WAV as
                // mono while the buffer holds interleaved stereo frames
                // halves the apparent playback rate ("slow motion").
                let stream_result = match sample_format {
                    SampleFormat::F32 => device.build_input_stream(
                        &stream_config,
                        move |data: &[f32], _: &_| {
                            // Downmix + convert into a local buffer FIRST so
                            // the shared `samples` mutex is only held long
                            // enough to `extend`. Otherwise the UI thread's
                            // 12 Hz peak poll can stall behind the entire
                            // sample-conversion loop on stereo input.
                            let mut local: Vec<i16> = Vec::with_capacity(
                                if channels <= 1 {
                                    data.len()
                                } else {
                                    data.len() / channels
                                },
                            );
                            let mut chunk_peak: f32 = 0.0;
                            if channels <= 1 {
                                for &s in data {
                                    let mono = s.clamp(-1.0, 1.0);
                                    let abs = mono.abs();
                                    if abs > chunk_peak {
                                        chunk_peak = abs;
                                    }
                                    local.push((mono * 32767.0) as i16);
                                }
                            } else {
                                for frame in data.chunks_exact(channels) {
                                    let avg =
                                        frame.iter().sum::<f32>() / channels as f32;
                                    let mono = avg.clamp(-1.0, 1.0);
                                    let abs = mono.abs();
                                    if abs > chunk_peak {
                                        chunk_peak = abs;
                                    }
                                    local.push((mono * 32767.0) as i16);
                                }
                            }
                            // Brief critical section: just extend + drop.
                            // `lock_or_recover` keeps the audio thread alive
                            // even if another thread poisoned the mutex.
                            {
                                let mut buf = lock_or_recover(&samples_clone);
                                buf.extend_from_slice(&local);
                            }
                            // Merge with whatever the consumer hasn't read
                            // yet — keep the loudest sample so a quiet poll
                            // window doesn't erase a recent transient.
                            {
                                let mut peak = lock_or_recover(&peak_clone_f32);
                                if chunk_peak > *peak {
                                    *peak = chunk_peak;
                                }
                            }
                            // Forward to the realtime emitter when this
                            // session was started in realtime mode. The
                            // emitter thread owns the resampler; we hand
                            // off raw native-rate mono i16 here.
                            if let Some(tx) = chunk_tx_f32.as_ref() {
                                let _ = tx.send(local);
                            }
                        },
                        err_fn,
                        None,
                    ),
                    SampleFormat::I16 => device.build_input_stream(
                        &stream_config,
                        move |data: &[i16], _: &_| {
                            // Same approach as F32: produce the mono samples
                            // into a local buffer, then take the shared lock
                            // only to append.
                            let mut chunk_peak_i: i32 = 0;
                            let local: Vec<i16> = if channels <= 1 {
                                for &s in data {
                                    let abs = (s as i32).abs();
                                    if abs > chunk_peak_i {
                                        chunk_peak_i = abs;
                                    }
                                }
                                data.to_vec()
                            } else {
                                let mut out = Vec::with_capacity(data.len() / channels);
                                for frame in data.chunks_exact(channels) {
                                    let sum: i32 =
                                        frame.iter().map(|&s| s as i32).sum();
                                    let mono = (sum / channels as i32) as i16;
                                    let abs = (mono as i32).abs();
                                    if abs > chunk_peak_i {
                                        chunk_peak_i = abs;
                                    }
                                    out.push(mono);
                                }
                                out
                            };
                            {
                                let mut buf = lock_or_recover(&samples_clone);
                                buf.extend_from_slice(&local);
                            }
                            // i16 range is [-32768, 32767]; divide by 32768
                            // for a symmetric 0..1 normalization.
                            let chunk_peak = (chunk_peak_i as f32) / 32768.0;
                            {
                                let mut peak = lock_or_recover(&peak_clone_i16);
                                if chunk_peak > *peak {
                                    *peak = chunk_peak;
                                }
                            }
                            if let Some(tx) = chunk_tx_i16.as_ref() {
                                let _ = tx.send(local);
                            }
                        },
                        err_fn,
                        None,
                    ),
                    other => {
                        let _ = ready_tx.send(Err(AudioError::CaptureFailed(format!(
                            "unsupported sample format {other:?}"
                        ))));
                        return;
                    }
                };
                let stream = match stream_result {
                    Ok(s) => s,
                    Err(e) => {
                        let _ = ready_tx.send(Err(AudioError::CaptureFailed(e.to_string())));
                        return;
                    }
                };
                if let Err(e) = stream.play() {
                    let _ = ready_tx.send(Err(AudioError::CaptureFailed(e.to_string())));
                    return;
                }
                if ready_tx.send(Ok(sample_rate)).is_err() {
                    return;
                }
                // Block this thread (which owns `stream`) until stop_capture is
                // called. Dropping `stream` here tears down cpal cleanly.
                let _ = stop_rx.recv();
                drop(stream);
            })
            .map_err(|e| AudioError::CaptureFailed(format!("failed to spawn worker: {e}")))?;

        let sample_rate = match ready_rx.recv() {
            Ok(Ok(rate)) => rate,
            Ok(Err(e)) => {
                let _ = worker.join();
                return Err(e);
            }
            Err(_) => {
                let _ = worker.join();
                return Err(AudioError::CaptureFailed(
                    "audio worker terminated before reporting readiness".into(),
                ));
            }
        };

        self.sessions.lock().unwrap().push(ActiveSession {
            id,
            samples,
            sample_rate,
            peak_level,
            stop_tx,
            worker: Some(worker),
            rt_emitter: None,
        });
        Ok((CaptureSession { id }, sample_rate))
    }

    /// Remove the session matching `id` from the active list and return it.
    /// Shared by `stop_capture` and `cancel_capture` so the lookup logic
    /// can't drift between the two paths.
    fn take_session(&self, id: Uuid) -> Result<ActiveSession, AudioError> {
        let mut sessions = self.sessions.lock().unwrap();
        let pos = sessions
            .iter()
            .position(|s| s.id == id)
            .ok_or_else(|| AudioError::CaptureFailed("session not found".into()))?;
        Ok(sessions.remove(pos))
    }
}

pub fn encode_wav_pcm16(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    let bytes_per_sample = 2u32;
    let num_channels = 1u32;
    let byte_rate = sample_rate * num_channels * bytes_per_sample;
    let block_align = (num_channels * bytes_per_sample) as u16;
    let data_len = (samples.len() as u32) * bytes_per_sample;
    let mut buf = Cursor::new(Vec::with_capacity(44 + data_len as usize));
    buf.write_all(b"RIFF").unwrap();
    buf.write_all(&(36 + data_len).to_le_bytes()).unwrap();
    buf.write_all(b"WAVE").unwrap();
    buf.write_all(b"fmt ").unwrap();
    buf.write_all(&16u32.to_le_bytes()).unwrap();
    buf.write_all(&1u16.to_le_bytes()).unwrap(); // PCM
    buf.write_all(&(num_channels as u16).to_le_bytes()).unwrap();
    buf.write_all(&sample_rate.to_le_bytes()).unwrap();
    buf.write_all(&byte_rate.to_le_bytes()).unwrap();
    buf.write_all(&block_align.to_le_bytes()).unwrap();
    buf.write_all(&16u16.to_le_bytes()).unwrap(); // bits per sample
    buf.write_all(b"data").unwrap();
    buf.write_all(&data_len.to_le_bytes()).unwrap();
    for s in samples {
        buf.write_all(&s.to_le_bytes()).unwrap();
    }
    buf.into_inner()
}

#[cfg(test)]
impl MicrophoneSource {
    /// Test-only helper: insert a synthetic session record so peak-tracking
    /// can be exercised without spinning up a real cpal stream.
    pub(crate) fn insert_test_session(&self, id: Uuid, initial_peak: f32) {
        let (stop_tx, _stop_rx) = mpsc::channel::<()>();
        self.sessions.lock().unwrap().push(ActiveSession {
            id,
            samples: Arc::new(Mutex::new(Vec::new())),
            sample_rate: 16_000,
            peak_level: Arc::new(Mutex::new(initial_peak)),
            stop_tx,
            worker: None,
            rt_emitter: None,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peak_level_resets_after_read() {
        let src = MicrophoneSource::new();
        let id = Uuid::new_v4();
        src.insert_test_session(id, 0.75);
        let first = src.peak_level_for(id).unwrap();
        assert!((first - 0.75).abs() < f32::EPSILON);
        let second = src.peak_level_for(id).unwrap();
        assert_eq!(second, 0.0);
    }

    #[test]
    fn peak_level_for_unknown_session_returns_none() {
        let src = MicrophoneSource::new();
        assert!(src.peak_level_for(Uuid::new_v4()).is_none());
    }

    #[test]
    fn cancel_capture_drops_session_without_producing_wav() {
        // Use the test-only session insert so we don't need a real cpal
        // stream. The trait method must remove the session and return Ok
        // without going through the WAV encoder path.
        let src = MicrophoneSource::new();
        let id = Uuid::new_v4();
        src.insert_test_session(id, 0.0);
        assert!(src.peak_level_for(id).is_some(), "session should be present");
        let session = CaptureSession { id };
        AudioSource::cancel_capture(&src, &session).expect("cancel should succeed");
        assert!(
            src.peak_level_for(id).is_none(),
            "session should be removed after cancel",
        );
    }

    #[test]
    fn cancel_capture_unknown_session_errors() {
        let src = MicrophoneSource::new();
        let session = CaptureSession { id: Uuid::new_v4() };
        assert!(AudioSource::cancel_capture(&src, &session).is_err());
    }

    #[test]
    fn audio_source_peak_level_delegates_to_session_lookup() {
        let src = MicrophoneSource::new();
        let id = Uuid::new_v4();
        src.insert_test_session(id, 0.42);
        let session = CaptureSession { id };
        let v = AudioSource::peak_level(&src, &session).unwrap();
        assert!((v - 0.42).abs() < f32::EPSILON);
    }

    #[test]
    fn wav_writer_produces_valid_header() {
        let bytes = encode_wav_pcm16(&[0, 0, 0, 0], 16000);
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
    }

    #[test]
    fn list_devices_returns_at_least_one_entry_or_empty_vec() {
        // CI runners always have at least the system default; locally devices
        // come and go. Just assert the call doesn't panic and returns something
        // serializable.
        let result = MicrophoneSource::list_devices();
        assert!(result.is_ok(), "list_devices should not error: {result:?}");
    }

    #[test]
    fn peak_level_under_lock_contention() {
        // Holding the `samples` lock on one thread must NOT block
        // `peak_level_for` on another thread — peak tracking uses a
        // separate mutex. If a future refactor merges the locks, this
        // test will deadlock (or block until the holder releases) and
        // surface the regression.
        use std::sync::Barrier;
        use std::time::Duration;

        let src = Arc::new(MicrophoneSource::new());
        let id = Uuid::new_v4();
        src.insert_test_session(id, 0.5);

        // Grab the `samples` Arc by reaching into the session list. This
        // mirrors what the cpal callback holds.
        let samples_arc = {
            let sessions = src.sessions.lock().unwrap();
            sessions.iter().find(|s| s.id == id).unwrap().samples.clone()
        };

        let barrier = Arc::new(Barrier::new(2));
        let release = Arc::new(Mutex::new(false));
        let release_holder = release.clone();
        let barrier_holder = barrier.clone();

        let holder = thread::spawn(move || {
            let _guard = samples_arc.lock().unwrap();
            barrier_holder.wait();
            // Spin until the main thread tells us we're done. Crucially,
            // we keep `_guard` held the entire time.
            loop {
                thread::sleep(Duration::from_millis(5));
                if *release_holder.lock().unwrap() {
                    break;
                }
            }
        });

        // Wait until the holder actually owns `samples`.
        barrier.wait();

        // This must complete promptly — it only touches `peak_level`.
        let v = src.peak_level_for(id).expect("session exists");
        assert!((v - 0.5).abs() < f32::EPSILON);

        *release.lock().unwrap() = true;
        holder.join().unwrap();
    }

    #[test]
    fn poisoned_samples_mutex_does_not_kill_callbacks() {
        // Approximation of the real-time recovery contract: poison a
        // Mutex<Vec<i16>> by panicking with the lock held, then verify
        // `lock_or_recover` still hands back the inner value instead of
        // propagating the poison (which would panic the audio thread).
        let m: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(vec![1, 2, 3]));
        let m_clone = m.clone();
        let poisoner = thread::spawn(move || {
            let _guard = m_clone.lock().unwrap();
            panic!("intentional poison");
        });
        // Join the panicking thread — its panic poisons the mutex but the
        // join itself returns an Err, not a panic on this thread.
        assert!(poisoner.join().is_err());
        assert!(m.lock().is_err(), "mutex should be poisoned");

        let guard = lock_or_recover(&m);
        assert_eq!(&*guard, &[1, 2, 3]);
    }

    #[test]
    fn encode_wav_pcm16_handles_empty_samples() {
        let bytes = encode_wav_pcm16(&[], 48_000);
        // RIFF header is 44 bytes for canonical PCM WAV (12 RIFF/WAVE +
        // 24 fmt + 8 data header).
        assert_eq!(bytes.len(), 44);
        assert_eq!(&bytes[..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(&bytes[12..16], b"fmt ");
        assert_eq!(&bytes[36..40], b"data");
        // data chunk size is the last 4 bytes; must be 0 for empty samples.
        let data_len = u32::from_le_bytes(bytes[40..44].try_into().unwrap());
        assert_eq!(data_len, 0);
        // RIFF chunk size = 36 + data_len = 36 when empty.
        let riff_len = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        assert_eq!(riff_len, 36);
    }
}
